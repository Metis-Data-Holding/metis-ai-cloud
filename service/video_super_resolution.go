package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const VideoSuperResolutionOptionKeyPrefix = "VideoSuperResolution:"

const videoSuperResolutionContextKey = "video_super_resolution.snapshot"

var (
	ErrVideoSuperResolutionUnsupportedModel = errors.New("video super-resolution supports Seedance 2.0 models only")
	ErrVideoSuperResolutionNotConfigured    = errors.New("video super-resolution is not configured")
	ErrVideoSuperResolutionPreflightFailed  = errors.New("video generation is temporarily unavailable")
)

func videoSuperResolutionPreflightFailure(c *gin.Context, cause error) error {
	diagnostic := videoSuperResolutionErrorDiagnostic(cause)
	requestContext := context.Background()
	if c != nil && c.Request != nil {
		requestContext = c.Request.Context()
	}
	logger.LogWarn(requestContext, fmt.Sprintf("video super-resolution preflight failed: %s", diagnostic))
	return ErrVideoSuperResolutionPreflightFailed
}

type VideoSuperResolutionConfig struct {
	Enabled           bool              `json:"enabled"`
	SourceResolution  string            `json:"source_resolution"`
	SourceResolutions map[string]string `json:"source_resolutions,omitempty"`
	PreserveOriginal  bool              `json:"preserve_original"`
}

type VideoSuperResolutionSnapshot struct {
	SourceResolution string `json:"source_resolution"`
	TargetResolution string `json:"target_resolution"`
	PreserveOriginal bool   `json:"preserve_original"`
}

type VideoSuperResolutionRuntimeConfig struct {
	AccessKey       string
	SecretKey       string
	SpaceName       string
	Region          string
	WorkflowID      string
	StoragePath     string
	StorageBasePath string
}

func DefaultVideoSuperResolutionConfig() VideoSuperResolutionConfig {
	return VideoSuperResolutionConfig{
		SourceResolution: "720p",
		PreserveOriginal: true,
	}
}

func normalizeVideoSuperResolutionModel(modelName string) string {
	return strings.TrimSpace(modelName)
}

func isSeedance20Model(modelName string) bool {
	switch strings.ToLower(normalizeVideoSuperResolutionModel(modelName)) {
	case "doubao-seedance-2-0-260128",
		"doubao-seedance-2-0-fast-260128",
		"dreamina-seedance-2-0-260128",
		"dreamina-seedance-2-0-fast-260128",
		"doubao-seedance-2.0",
		"doubao-seedance-2.0-fast",
		"dreamina-seedance-2.0",
		"dreamina-seedance-2.0-fast":
		return true
	default:
		return false
	}
}

func IsVideoSuperResolutionModel(modelName string) bool {
	return isSeedance20Model(modelName)
}

// 官方 ModelArk 分辨率档位（2026-09-14）；内部超分不能扩大模型对外承诺。
// https://docs.byteplus.com/docs/ModelArk/1099320
func VideoSuperResolutionTargets(modelName string) []string {
	if !isSeedance20Model(modelName) || strings.Contains(strings.ToLower(modelName), "fast") {
		return []string{}
	}
	return []string{"1080p", "4k"}
}

func GetVideoSuperResolutionConfig(modelName string) VideoSuperResolutionConfig {
	config, ok := lookupVideoSuperResolutionConfig(modelName)
	if !ok {
		config = DefaultVideoSuperResolutionConfig()
	}
	// 旧配置的单一源分辨率按各目标展开，不修改持久化数据或在途任务快照。
	sources := make(map[string]string)
	for _, target := range VideoSuperResolutionTargets(modelName) {
		sources[target] = config.SourceResolution
		if source := config.SourceResolutions[target]; source == "480p" || source == "720p" {
			sources[target] = source
		}
	}
	config.SourceResolutions = sources
	if len(sources) == 0 {
		config.Enabled = false
	}
	return config
}

func lookupVideoSuperResolutionConfig(modelName string) (VideoSuperResolutionConfig, bool) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return VideoSuperResolutionConfig{}, false
	}
	common.OptionMapRWMutex.RLock()
	raw, ok := common.OptionMap[VideoSuperResolutionOptionKeyPrefix+modelName]
	common.OptionMapRWMutex.RUnlock()
	if !ok || strings.TrimSpace(raw) == "" {
		return VideoSuperResolutionConfig{}, false
	}
	var config VideoSuperResolutionConfig
	if common.UnmarshalJsonStr(raw, &config) != nil {
		return VideoSuperResolutionConfig{}, false
	}
	return normalizeVideoSuperResolutionConfig(config), true
}

func normalizeVideoSuperResolutionConfig(config VideoSuperResolutionConfig) VideoSuperResolutionConfig {
	if config.SourceResolution != "480p" && config.SourceResolution != "720p" {
		config.SourceResolution = "720p"
	}
	return config
}

func SaveVideoSuperResolutionConfig(modelName string, config VideoSuperResolutionConfig) error {
	modelName = normalizeVideoSuperResolutionModel(modelName)
	if modelName == "" || len(modelName) > 128 || strings.ContainsAny(modelName, "\r\n\x00") {
		return errors.New("model_name is required")
	}
	if config.SourceResolution != "480p" && config.SourceResolution != "720p" {
		return errors.New("source_resolution must be 480p or 720p")
	}
	if !isSeedance20Model(modelName) {
		return ErrVideoSuperResolutionUnsupportedModel
	}
	targets := VideoSuperResolutionTargets(modelName)
	if config.Enabled && len(targets) == 0 {
		return errors.New("该模型没有官方支持的高分辨率超分档位")
	}
	for target, source := range config.SourceResolutions {
		if !slices.Contains(targets, target) {
			return fmt.Errorf("unsupported super-resolution target: %s", target)
		}
		if source != "480p" && source != "720p" {
			return errors.New("source resolution must be 480p or 720p")
		}
	}
	config = normalizeVideoSuperResolutionConfig(config)
	encoded, err := common.Marshal(config)
	if err != nil {
		return err
	}
	return model.UpdateOption(VideoSuperResolutionOptionKeyPrefix+modelName, string(encoded))
}

func targetResolution(value any) string {
	raw := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if raw == "4k" || raw == "2160p" {
		return "4k"
	}
	if raw == "2k" || raw == "1440p" {
		return "2k"
	}
	if raw == "1080p" {
		return "1080p"
	}
	if raw == "720p" {
		return "720p"
	}
	if raw == "480p" {
		return "480p"
	}
	parts := strings.Split(strings.ReplaceAll(raw, "*", "x"), "x")
	if len(parts) == 2 {
		width, widthErr := strconv.Atoi(parts[0])
		height, heightErr := strconv.Atoi(parts[1])
		if widthErr == nil && heightErr == nil {
			// 尺寸兼容入口只接受明确的横屏/竖屏组合，避免任意长边被归入高分档。
			switch fmt.Sprintf("%dx%d", max(width, height), min(width, height)) {
			case "854x480", "848x480", "640x480":
				return "480p"
			case "1280x720":
				return "720p"
			case "1920x1080":
				return "1080p"
			case "2560x1440":
				return "2k"
			case "3840x2160":
				return "4k"
			}
		}
	}
	return ""
}

func resolutionNeedsSuperResolution(resolution string) bool {
	return resolution == "1080p" || resolution == "2k" || resolution == "4k"
}

func ApplyVideoSuperResolution(c *gin.Context, pluginKey, originModelName, upstreamModelName string, descriptorBody any) error {
	c.Set(videoSuperResolutionContextKey, nil)
	c.Set(videoSuperResolutionRuntimeContextKey, nil)
	body, isBody := descriptorBody.(map[string]any)
	bodyModelName, _ := body["model"].(string)
	modelName := firstString(bodyModelName, upstreamModelName, originModelName)
	rawResolution, explicit := body["resolution"]
	if !explicit {
		rawResolution, explicit = body["size"]
	}
	resolution := targetResolution(rawResolution)
	// 无论是否启用超分，均在改写请求和付费生成前限制已识别模型的档位。
	if pluginKey == "doubao" && isSeedance20Model(modelName) && explicit {
		raw := strings.ToLower(strings.TrimSpace(fmt.Sprint(rawResolution)))
		known := raw == "480p" || raw == "720p" || raw == "1080p" || raw == "4k"
		if (strings.Contains(raw, "x") || strings.Contains(raw, "*")) && resolution != "" {
			known = true
		}
		if !known || (resolution != "480p" && resolution != "720p" && !slices.Contains(VideoSuperResolutionTargets(modelName), resolution)) {
			return errors.New("该模型不支持请求的视频分辨率")
		}
	}
	config, configured := lookupVideoSuperResolutionConfig(originModelName)
	if !configured || !config.Enabled {
		return nil
	}
	if pluginKey != "doubao" || !isSeedance20Model(modelName) {
		return ErrVideoSuperResolutionUnsupportedModel
	}
	if !isBody {
		return errors.New("video super-resolution requires a JSON submit body")
	}
	if !resolutionNeedsSuperResolution(resolution) {
		return nil
	}
	config = normalizeVideoSuperResolutionConfig(config)
	runtime, err := videoSuperResolutionRuntimeConfig(resolution)
	if err != nil {
		return err
	}
	if runtime.WorkflowID == "" {
		return ErrVideoSuperResolutionNotConfigured
	}
	client := NewVideoSuperResolutionVODClient(runtime)
	requestContext := context.Background()
	if c.Request != nil {
		requestContext = c.Request.Context()
	}
	domain, err := client.ListDomain(requestContext, runtime.SpaceName)
	if err != nil {
		return videoSuperResolutionPreflightFailure(c, err)
	}
	if strings.TrimSpace(domain.DefaultPlayDomain) == "" {
		return videoSuperResolutionPreflightFailure(c, newVideoSuperResolutionVODError("ListDomain", 200, "missing_default_play_domain"))
	}
	source := config.SourceResolution
	if configuredSource := config.SourceResolutions[resolution]; configuredSource == "480p" || configuredSource == "720p" {
		source = configuredSource
	}
	body["resolution"] = source
	c.Set(videoSuperResolutionContextKey, VideoSuperResolutionSnapshot{
		SourceResolution: source,
		TargetResolution: resolution,
		PreserveOriginal: config.PreserveOriginal,
	})
	c.Set(videoSuperResolutionRuntimeContextKey, runtime)
	return nil
}

func GetVideoSuperResolutionSnapshot(c *gin.Context) (VideoSuperResolutionSnapshot, bool) {
	if c == nil {
		return VideoSuperResolutionSnapshot{}, false
	}
	value, ok := c.Get(videoSuperResolutionContextKey)
	snapshot, valid := value.(VideoSuperResolutionSnapshot)
	return snapshot, ok && valid
}

const videoSuperResolutionRuntimeContextKey = "video_super_resolution.runtime"

func GetVideoSuperResolutionRuntimeConfig(c *gin.Context) (VideoSuperResolutionRuntimeConfig, bool) {
	if c == nil {
		return VideoSuperResolutionRuntimeConfig{}, false
	}
	value, ok := c.Get(videoSuperResolutionRuntimeContextKey)
	runtime, valid := value.(VideoSuperResolutionRuntimeConfig)
	return runtime, ok && valid
}

func videoSuperResolutionRuntimeConfig(target string) (VideoSuperResolutionRuntimeConfig, error) {
	runtime := VideoSuperResolutionRuntimeConfig{
		AccessKey:   strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_ACCESS_KEY")),
		SecretKey:   strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SECRET_KEY")),
		SpaceName:   strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SPACE")),
		Region:      "ap-southeast-1",
		StoragePath: strings.TrimSpace(os.Getenv("VIDEO_SR_STORAGE_PATH")),
	}
	switch target {
	case "4k":
		runtime.WorkflowID = strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SR_WORKFLOW_4K"))
	case "2k":
		runtime.WorkflowID = strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SR_WORKFLOW_2K"))
	case "1080p":
		runtime.WorkflowID = strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SR_WORKFLOW_1080P"))
	default:
		return VideoSuperResolutionRuntimeConfig{}, errors.New("unsupported super-resolution target")
	}
	if runtime.AccessKey == "" || runtime.SecretKey == "" || runtime.SpaceName == "" || runtime.StoragePath == "" {
		return VideoSuperResolutionRuntimeConfig{}, ErrVideoSuperResolutionNotConfigured
	}
	info, err := os.Stat(runtime.StoragePath)
	if err != nil || !info.IsDir() {
		return VideoSuperResolutionRuntimeConfig{}, fmt.Errorf("video super-resolution storage path is unavailable")
	}
	if err := ensureWritableDirectory(runtime.StoragePath); err != nil {
		return VideoSuperResolutionRuntimeConfig{}, fmt.Errorf("video super-resolution storage path is not writable: %w", err)
	}
	runtime.StorageBasePath, err = filepath.Abs(runtime.StoragePath)
	if err != nil {
		return VideoSuperResolutionRuntimeConfig{}, err
	}
	return runtime, nil
}

func ensureWritableDirectory(path string) error {
	testFile, err := os.CreateTemp(path, ".video-sr-check-*")
	if err != nil {
		return err
	}
	testName := testFile.Name()
	if err := testFile.Close(); err != nil {
		_ = os.Remove(testName)
		return err
	}
	return os.Remove(testName)
}

// ClearVideoSuperResolutionSnapshot 防止渠道重试复用上次尝试的内部路由。
func ClearVideoSuperResolutionSnapshot(c *gin.Context) {
	c.Set(videoSuperResolutionContextKey, nil)
	c.Set(videoSuperResolutionRuntimeContextKey, nil)
}
