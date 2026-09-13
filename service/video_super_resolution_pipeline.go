package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/abema/go-mp4"
)

const (
	superResolutionPhaseGeneration         = "generation"
	superResolutionPhaseUploadPending      = "upload_pending"
	superResolutionPhaseUploadProcessing   = "upload_processing"
	superResolutionPhaseWorkflowPending    = "workflow_pending"
	superResolutionPhaseWorkflowProcessing = "workflow_processing"
	superResolutionPhaseMediaInfo          = "media_info"
	superResolutionPhasePublish            = "publish"
	superResolutionPhasePlayInfo           = "play_info"
	superResolutionPhaseDownloading        = "downloading"
	superResolutionPhaseComplete           = "complete"
	maxVideoSuperResolutionBytes           = int64(512 << 20)
)

func isVideoSuperResolutionPipelineTask(task *model.Task) bool {
	return task != nil && task.PrivateData.SuperResolution != nil
}
func shouldPollVideoSuperResolution(task *model.Task) bool {
	return isVideoSuperResolutionPipelineTask(task) && task.PrivateData.SuperResolution.Phase != superResolutionPhaseGeneration
}

func captureVideoSuperResolutionGeneration(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task, result *relaycommon.TaskInfo, fromStatus model.TaskStatus) error {
	state := task.PrivateData.SuperResolution
	before := *state
	task.Status = fromStatus
	task.PrivateData.ResultURL = ""
	task.SetData(map[string]any{"status": "processing"})
	if len(result.PluginState) > 0 {
		task.PrivateData.PluginState = result.PluginState
	}
	if result.Status == model.TaskStatusFailure {
		return failVideoSuperResolutionTask(ctx, adaptor, task, "视频生成失败")
	}
	if result.Status == model.TaskStatusSuccess {
		if err := ValidateSSRFProtectedFetchURL(result.Url); err != nil || result.Url == "" {
			return failVideoSuperResolutionTask(ctx, adaptor, task, "视频生成结果不可用")
		}
		state.OriginalURL = result.Url
		state.UsageFacts = result.UsageFacts
		state.GenerationCompletionTokens = result.CompletionTokens
		state.GenerationTotalTokens = result.TotalTokens
		state.Phase = superResolutionPhaseUploadPending
		task.Status = model.TaskStatusInProgress
		task.Progress = "45%"
		task.FinishTime = 0
	} else {
		task.Status = model.TaskStatus(result.Status)
		task.Progress = "20%"
	}
	task.PrivateData.PollFailures = 0
	if task.StartTime == 0 {
		task.StartTime = time.Now().Unix()
	}
	return saveVideoSuperResolutionState(task, fromStatus, before)
}

func updateVideoSuperResolutionTask(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task) error {
	state := task.PrivateData.SuperResolution
	if state == nil || task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure {
		return nil
	}
	runtime, err := videoSuperResolutionRuntimeConfig(state.TargetResolution)
	if err != nil {
		return err
	}
	runtime.WorkflowID = state.WorkflowID
	client := NewVideoSuperResolutionVODClient(runtime)
	fromStatus := task.Status
	before := *state
	switch state.Phase {
	case superResolutionPhaseUploadPending:
		if err := ValidateSSRFProtectedFetchURL(state.OriginalURL); err != nil || state.OriginalURL == "" {
			return failVideoSuperResolutionTask(ctx, adaptor, task, "原片下载地址不可用")
		}
		claimed, err := task.ClaimSuperResolutionUpload()
		if err != nil || !claimed {
			return err
		}
		state = task.PrivateData.SuperResolution
		before = *state
		upload, err := client.UploadMediaByURL(ctx, state.OriginalURL)
		if err != nil {
			return failVideoSuperResolutionTask(ctx, adaptor, task, "原片上传结果不确定，请管理员核对")
		}
		state.UploadJobID = upload.JobID
		state.Phase = superResolutionPhaseUploadProcessing
	case "upload_submitting":
		// 崩溃或网络断开后不能确认 JobId，不重放可能收费的上传请求。
		return failVideoSuperResolutionTask(ctx, adaptor, task, "原片上传结果不确定，请管理员核对")
	case superResolutionPhaseUploadProcessing:
		upload, err := client.QueryUploadTaskInfo(ctx, state.UploadJobID)
		if err != nil {
			return err
		}
		switch strings.ToLower(upload.State) {
		case "initial", "processing":
			task.Progress = "55%"
		case "failed":
			return failVideoSuperResolutionTask(ctx, adaptor, task, "原片上传失败")
		case "success":
			if upload.VID == "" {
				return errors.New("VOD upload has no Vid")
			}
			state.VID = upload.VID
			state.SourceFileID = upload.FileID
			state.Phase = superResolutionPhaseWorkflowPending
			task.Progress = "60%"
		default:
			return errors.New("unrecognized VOD upload state")
		}
	case superResolutionPhaseWorkflowPending:
		// StartWorkflow 官方保证同参数/ClientToken 幂等；固定 token 允许响应丢失后安全重试。
		// https://docs.byteplus.com/en/docs/byteplus-vod/reference-startworkflow
		workflow, err := client.StartWorkflow(ctx, state.VID, videoSuperResolutionClientToken(task.TaskID, state.WorkflowID))
		if err != nil {
			return err
		}
		state.RunID = workflow.RunID
		state.Phase = superResolutionPhaseWorkflowProcessing
		task.Progress = "65%"
	case superResolutionPhaseWorkflowProcessing:
		result, err := client.GetWorkflowExecutionResult(ctx, state.RunID)
		if err != nil {
			return err
		}
		switch strings.ToLower(result.Status) {
		case "pendingstart", "running":
			task.Progress = "70%"
		case "0":
			state.Phase = superResolutionPhaseMediaInfo
			task.Progress = "75%"
		default:
			return failVideoSuperResolutionTask(ctx, adaptor, task, "超分处理失败")
		}
	case superResolutionPhaseMediaInfo:
		media, err := client.GetMediaInfos(ctx, state.VID)
		if err != nil {
			return err
		}
		if len(media) != 1 || media[0].FileID == "" {
			return errors.New("VOD source identity is missing")
		}
		state.SourceFileID = media[0].FileID
		state.Phase = superResolutionPhasePublish
	case superResolutionPhasePublish:
		if err := client.UpdateMediaPublishStatus(ctx, state.VID); err != nil {
			return err
		}
		state.Phase = superResolutionPhasePlayInfo
		task.Progress = "80%"
	case superResolutionPhasePlayInfo:
		items, err := client.GetPlayInfo(ctx, state.VID)
		if err != nil {
			return err
		}
		selected, err := selectVideoSuperResolutionPlayInfo(items, state)
		if err != nil {
			return err
		}
		state.OutputURL = selected.MainPlayURL
		state.Phase = superResolutionPhaseDownloading
		task.Progress = "85%"
	case superResolutionPhaseDownloading:
		if err := downloadVideoSuperResolutionFiles(ctx, task, runtime); err != nil {
			return failVideoSuperResolutionTask(ctx, adaptor, task, "超分成片保存或校验失败")
		}
		state.Phase = superResolutionPhaseComplete
		state.CleanupStatus = "pending"
		state.OutputFile = filepath.Base(state.OutputPath)
		task.Status = model.TaskStatusSuccess
		task.Progress = taskcommon.ProgressComplete
		task.FinishTime = time.Now().Unix()
		task.PrivateData.ResultURL = taskcommon.BuildProxyURL(task.TaskID)
		task.SetData(map[string]any{"status": "succeeded", "content": map[string]any{"video_url": task.PrivateData.ResultURL}})
		won, err := task.UpdateSuperResolutionState(fromStatus, before)
		if err != nil || !won {
			return err
		}
		settleTaskBillingOnComplete(ctx, adaptor, task, &relaycommon.TaskInfo{Status: model.TaskStatusSuccess, Url: task.PrivateData.ResultURL, UsageFacts: state.UsageFacts, CompletionTokens: state.GenerationCompletionTokens, TotalTokens: state.GenerationTotalTokens})
		return nil
	default:
		return failVideoSuperResolutionTask(ctx, adaptor, task, "内部视频处理状态异常")
	}
	task.PrivateData.PollFailures = 0
	return saveVideoSuperResolutionState(task, fromStatus, before)
}

func saveVideoSuperResolutionState(task *model.Task, fromStatus model.TaskStatus, before model.TaskSuperResolutionState) error {
	_, err := task.UpdateSuperResolutionState(fromStatus, before)
	return err
}

func failVideoSuperResolutionTask(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task, reason string) error {
	fromStatus := task.Status
	before := *task.PrivateData.SuperResolution
	if fromStatus == model.TaskStatusFailure || fromStatus == model.TaskStatusSuccess {
		return nil
	}
	task.Status = model.TaskStatusFailure
	task.Progress = taskcommon.ProgressComplete
	task.FinishTime = time.Now().Unix()
	task.PrivateData.SuperResolution.LastError = reason
	task.FailReason = "视频生成失败，请稍后重试"
	task.PrivateData.ResultURL = ""
	task.PrivateData.SuperResolution.CleanupStatus = "pending"
	task.SetData(map[string]any{"status": "failed", "error": map[string]any{"message": task.FailReason}})
	won, err := task.UpdateSuperResolutionState(fromStatus, before)
	if err != nil || !won {
		return err
	}
	if task.Quota != 0 {
		RefundTaskQuota(ctx, task, task.FailReason)
	}
	return nil
}

// sweepVideoSuperResolutionCleanup 独立处理终态清理，删除失败不影响已经交付的视频和退款。
func sweepVideoSuperResolutionCleanup(ctx context.Context) {
	tasks, err := model.GetSuperResolutionCleanupTasks(25)
	if err != nil {
		common.SysError("查询超分清理任务失败")
		return
	}
	for _, task := range tasks {
		if ctx.Err() != nil {
			return
		}
		cleanupVideoSuperResolutionTask(ctx, task)
	}
}

func cleanupVideoSuperResolutionTask(ctx context.Context, task *model.Task) {
	state := task.PrivateData.SuperResolution
	if state == nil {
		return
	}
	before := *state
	// 失败成片不可对外使用；原片仅在管理员选择保留时留存。
	if task.Status == model.TaskStatusFailure {
		removeVideoSuperResolutionFile(task, false)
		state.OutputPath = ""
	}
	if !state.PreserveOriginal {
		removeVideoSuperResolutionFile(task, true)
		state.OriginalPath = ""
	}
	runtime := VideoSuperResolutionRuntimeConfig{AccessKey: strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_ACCESS_KEY")), SecretKey: strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SECRET_KEY")), SpaceName: strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SPACE")), Region: "ap-southeast-1"}
	if runtime.AccessKey == "" || runtime.SecretKey == "" {
		return
	}
	client := NewVideoSuperResolutionVODClient(runtime)
	if state.VID == "" && state.UploadJobID != "" {
		upload, queryErr := client.QueryUploadTaskInfo(ctx, state.UploadJobID)
		if queryErr != nil {
			return
		}
		if upload.State == "success" {
			state.VID = upload.VID
		} else if upload.State == "failed" {
			state.CleanupStatus = "confirmed"
		} else {
			return
		}
	}
	if state.VID != "" {
		_, queryErr := client.GetMediaInfos(ctx, state.VID)
		if errors.Is(queryErr, ErrVideoSuperResolutionMediaNotFound) {
			state.CleanupStatus = "confirmed"
		} else if queryErr == nil {
			if client.DeleteMedia(ctx, state.VID) == nil {
				state.CleanupStatus = "requested"
			}
		}
	} else if state.UploadJobID == "" {
		if state.Phase == "upload_submitting" {
			state.CleanupStatus = "unknown"
		} else {
			state.CleanupStatus = "confirmed"
		}
	}
	if state.CleanupStatus == "confirmed" {
		state.OriginalURL = ""
		state.OutputURL = ""
	}
	task.UpdatedAt = time.Now().Unix()
	_ = saveVideoSuperResolutionState(task, task.Status, before)
}

func videoSuperResolutionClientToken(taskID, workflowID string) string {
	digest := sha256.Sum256([]byte(taskID + "\x00" + workflowID))
	return hex.EncodeToString(digest[:])
}

func selectVideoSuperResolutionPlayInfo(items []VideoSuperResolutionPlayInfo, state *model.TaskSuperResolutionState) (VideoSuperResolutionPlayInfo, error) {
	minEdge := 1080
	if state.TargetResolution == "4k" {
		minEdge = 2160
	}
	var selected VideoSuperResolutionPlayInfo
	count := 0
	for _, item := range items {
		if item.FileID == "" || item.FileID == state.SourceFileID || strings.TrimSpace(item.MainPlayURL) == "" {
			continue
		}
		if min(item.Width, item.Height) < minEdge || item.Format != "mp4" {
			continue
		}
		selected = item
		count++
	}
	if count != 1 {
		return VideoSuperResolutionPlayInfo{}, errors.New("video super-resolution output is unavailable")
	}
	return selected, nil
}

func downloadVideoSuperResolutionFiles(ctx context.Context, task *model.Task, runtime VideoSuperResolutionRuntimeConfig) error {
	state := task.PrivateData.SuperResolution
	if state == nil || state.OutputURL == "" {
		return errors.New("video super-resolution output URL is empty")
	}
	if err := ValidateSSRFProtectedFetchURL(state.OutputURL); err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%s", task.ID, task.UserId, task.TaskID)))
	base := hex.EncodeToString(digest[:])
	outputPath := filepath.Join(runtime.StorageBasePath, base+".output.mp4")
	if err := ensurePrivateStoragePath(runtime.StorageBasePath, outputPath); err != nil {
		return err
	}
	meta, err := downloadAndProbeVideo(ctx, state.OutputURL, outputPath)
	if err != nil {
		return err
	}
	minEdge := 1080
	if state.TargetResolution == "4k" {
		minEdge = 2160
	}
	if min(meta.Width, meta.Height) < minEdge || max(meta.Width, meta.Height) > 8192 || !isFinitePositive(meta.Duration) || meta.FPS <= 0 || meta.FPS > 120 {
		_ = os.Remove(outputPath)
		return errors.New("video super-resolution output metadata is invalid")
	}
	state.OutputPath = outputPath
	state.OutputDuration, state.OutputWidth, state.OutputHeight, state.OutputFPS = meta.Duration, meta.Width, meta.Height, meta.FPS
	state.EstimateUSD = videoSuperResolutionEstimateUSD(state.TargetResolution, meta.Duration, meta.FPS)
	if state.PreserveOriginal {
		originalPath := filepath.Join(runtime.StorageBasePath, base+".original.mp4")
		if err := ensurePrivateStoragePath(runtime.StorageBasePath, originalPath); err != nil {
			return err
		}
		if err := downloadVideoFile(ctx, state.OriginalURL, originalPath); err != nil {
			return err
		}
		state.OriginalPath = originalPath
	}
	return nil
}

type videoFileMetadata struct {
	Duration float64
	Width    int
	Height   int
	FPS      float64
}

func downloadAndProbeVideo(ctx context.Context, sourceURL, targetPath string) (videoFileMetadata, error) {
	if err := downloadVideoFile(ctx, sourceURL, targetPath); err != nil {
		return videoFileMetadata{}, err
	}
	file, err := os.Open(targetPath)
	if err != nil {
		return videoFileMetadata{}, err
	}
	defer file.Close()
	info, err := mp4.Probe(file)
	if err != nil || info.Timescale == 0 {
		return videoFileMetadata{}, errors.New("invalid MP4 output")
	}
	metadata := videoFileMetadata{Duration: float64(info.Duration) / float64(info.Timescale)}
	for _, track := range info.Tracks {
		if track == nil || track.AVC == nil || track.Timescale == 0 {
			continue
		}
		metadata.Width, metadata.Height = int(track.AVC.Width), int(track.AVC.Height)
		if track.Duration > 0 {
			trackDuration := float64(track.Duration) / float64(track.Timescale)
			if trackDuration > 0 && len(track.Samples) > 0 {
				metadata.Duration = trackDuration
				metadata.FPS = float64(len(track.Samples)) / trackDuration
			}
		}
		break
	}
	if metadata.Width <= 0 || metadata.Height <= 0 {
		return videoFileMetadata{}, errors.New("MP4 video track is missing")
	}
	return metadata, nil
}

func downloadVideoFile(ctx context.Context, sourceURL, targetPath string) error {
	if err := ValidateSSRFProtectedFetchURL(sourceURL); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	response, err := GetSSRFProtectedHTTPClient().Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("video download returned HTTP %d", response.StatusCode)
	}
	file, err := os.CreateTemp(filepath.Dir(targetPath), ".sr-download-*")
	if err != nil {
		return err
	}
	temporaryPath := file.Name()
	keep := false
	defer func() {
		_ = file.Close()
		if !keep {
			_ = os.Remove(temporaryPath)
		}
	}()
	written, err := io.Copy(file, io.LimitReader(response.Body, maxVideoSuperResolutionBytes+1))
	if err != nil {
		return err
	}
	if written > maxVideoSuperResolutionBytes {
		return errors.New("video output is too large")
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		return err
	}
	keep = true
	return nil
}

func ensurePrivateStoragePath(basePath, path string) error {
	base, err := filepath.Abs(basePath)
	if err != nil {
		return err
	}
	target, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(base, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("video storage path escapes configured directory")
	}
	return nil
}

func isFinitePositive(value float64) bool {
	return value > 0 && value <= 3600 && value == value
}

func videoSuperResolutionEstimateUSD(target string, duration, fps float64) float64 {
	if !isFinitePositive(duration) || fps <= 0 || fps > 120 || math.IsNaN(fps) {
		return 0
	}
	// BytePlus Fast 公开单价，USD/分钟；仅供成本估算，不写入客户账单。
	price := 0.2066
	if target == "4k" {
		price = 0.8264
	}
	if fps > 30 && fps <= 60 {
		price *= 2
	} else if fps > 60 && fps <= 120 {
		price *= 4
	}
	return price * duration / 60
}

func videoSuperResolutionFileName(task *model.Task, original bool) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%s", task.ID, task.UserId, task.TaskID)))
	suffix := ".output.mp4"
	if original {
		suffix = ".original.mp4"
	}
	return hex.EncodeToString(digest[:]) + suffix
}

// OpenVideoSuperResolutionFile 只按任务派生的文件名打开专用目录中的文件，禁止软链接逃逸。
func OpenVideoSuperResolutionFile(task *model.Task, original bool) (*os.File, error) {
	if task == nil || task.PrivateData.SuperResolution == nil {
		return nil, os.ErrNotExist
	}
	state := task.PrivateData.SuperResolution
	if original {
		if !state.PreserveOriginal || state.OriginalPath == "" {
			return nil, os.ErrNotExist
		}
	} else if task.Status != model.TaskStatusSuccess || state.OutputPath == "" {
		return nil, os.ErrNotExist
	}
	base := strings.TrimSpace(os.Getenv("VIDEO_SR_STORAGE_PATH"))
	if base == "" {
		return nil, os.ErrNotExist
	}
	root, err := os.OpenRoot(base)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.Open(videoSuperResolutionFileName(task, original))
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, os.ErrNotExist
	}
	return file, nil
}

func removeVideoSuperResolutionFile(task *model.Task, original bool) {
	base := strings.TrimSpace(os.Getenv("VIDEO_SR_STORAGE_PATH"))
	if base == "" {
		return
	}
	root, err := os.OpenRoot(base)
	if err != nil {
		return
	}
	defer root.Close()
	_ = root.Remove(videoSuperResolutionFileName(task, original))
}

// VideoSuperResolutionPublicData 白名单生成公开投影，不暴露原片、VOD 标识和本地路径。
func VideoSuperResolutionPublicData(task *model.Task) []byte {
	if !isVideoSuperResolutionPipelineTask(task) {
		return task.Data
	}
	data := map[string]any{"id": task.TaskID, "status": "processing"}
	if task.Status == model.TaskStatusSuccess {
		data["status"] = "succeeded"
		data["content"] = map[string]any{"video_url": taskcommon.BuildProxyURL(task.TaskID)}
	} else if task.Status == model.TaskStatusFailure {
		data["status"] = "failed"
	}
	encoded, _ := common.Marshal(data)
	return encoded
}
