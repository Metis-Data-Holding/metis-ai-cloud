package service

import (
	"bytes"
	"context"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type srBillingAdaptor struct {
	scriptedPollingAdaptor
	settlements int
}

func (a *srBillingAdaptor) AdjustBillingOnComplete(*model.Task, *relaycommon.TaskInfo) int {
	a.settlements++
	return 0
}

func TestSuperResolutionGenerationKeepsTaskPending(t *testing.T) {
	truncate(t)
	task := makeTask(510, 510, 0, 0, BillingSourceWallet, 0)
	task.TaskID = "task_sr_generation"
	task.PrivateData.SuperResolution = &model.TaskSuperResolutionState{Phase: "generation", TargetResolution: "1080p", SourceResolution: "720p"}
	require.NoError(t, model.DB.Create(task).Error)
	a := &srBillingAdaptor{scriptedPollingAdaptor: scriptedPollingAdaptor{
		body:  []byte(`{"content":{"video_url":"https://8.8.8.8/original.mp4"}}`),
		parse: &relaycommon.TaskInfo{Status: model.TaskStatusSuccess, Progress: "100%", Url: "https://8.8.8.8/original.mp4"},
	}}
	require.NoError(t, updateVideoSingleTask(context.Background(), a, &model.Channel{}, task.TaskID, map[string]*model.Task{task.TaskID: task}))
	var saved model.Task
	require.NoError(t, model.DB.First(&saved, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusInProgress, saved.Status)
	assert.Equal(t, "45%", saved.Progress)
	assert.Zero(t, saved.FinishTime)
	assert.Zero(t, a.settlements)
	assert.NotContains(t, string(saved.Data), "original.mp4")
	assert.Equal(t, "https://8.8.8.8/original.mp4", saved.PrivateData.SuperResolution.OriginalURL)
}

type srTransport func(*http.Request) (*http.Response, error)

func (f srTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func configureSRTest(t *testing.T) {
	t.Helper()
	t.Setenv("BYTEPLUS_VOD_ACCESS_KEY", "test-ak")
	t.Setenv("BYTEPLUS_VOD_SECRET_KEY", "test-sk")
	t.Setenv("BYTEPLUS_VOD_SPACE", "test-space")
	t.Setenv("BYTEPLUS_VOD_SR_WORKFLOW_1080P", "workflow-fast-1080")
	t.Setenv("VIDEO_SR_STORAGE_PATH", t.TempDir())
	oldLimit := constant.TaskQueryLimit
	constant.TaskQueryLimit = 100
	t.Cleanup(func() { constant.TaskQueryLimit = oldLimit })
	oldFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return nil }
	t.Cleanup(func() { GetTaskAdaptorFunc = oldFactory })
}

func TestSuperResolutionPipelineDeliversAndCleansWithoutGenerationChannel(t *testing.T) {
	for _, scenario := range []struct {
		name, target  string
		preserve      bool
		width, height int
		estimate      float64
	}{
		{"1080p without original", "1080p", false, 1920, 1080, 0.000286944444444},
		{"1080p with original", "1080p", true, 1920, 1080, 0.000286944444444},
		{"4k with original", "4k", true, 3840, 2160, 0.001147777777778},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			preserve := scenario.preserve
			truncate(t)
			configureSRTest(t)
			video, err := os.ReadFile("testdata/sr-" + scenario.target + ".mp4")
			require.NoError(t, err)
			task := makeTask(510, 999999, 0, 0, BillingSourceWallet, 0)
			task.TaskID = "task_sr_pipeline"
			task.Progress = "45%"
			task.PrivateData.SuperResolution = &model.TaskSuperResolutionState{Phase: "upload_pending", SourceResolution: "720p", TargetResolution: scenario.target, PreserveOriginal: preserve, WorkflowID: "workflow-fast-1080", OriginalURL: "https://8.8.8.8/source.mp4"}
			require.NoError(t, model.DB.Create(task).Error)
			counts := map[string]int{}
			deleted := false
			oldVOD := videoSuperResolutionHTTPClient
			oldProtected := ssrfProtectedHTTPClient
			oldHTTP := httpClient
			t.Cleanup(func() {
				videoSuperResolutionHTTPClient = oldVOD
				ssrfProtectedHTTPClient = oldProtected
				httpClient = oldHTTP
			})
			videoSuperResolutionHTTPClient = &http.Client{Transport: srTransport(func(r *http.Request) (*http.Response, error) {
				action := r.URL.Query().Get("Action")
				counts[action]++
				require.Contains(t, r.Header.Get("Authorization"), "Credential=test-ak/")
				assert.Equal(t, "2023-01-01", r.URL.Query().Get("Version"))
				result := `{}`
				switch action {
				case "UploadMediaByUrl":
					assert.Equal(t, "POST", r.Method)
					assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))
					require.NoError(t, r.ParseForm())
					assert.Equal(t, "test-space", r.PostForm.Get("SpaceName"))
					assert.JSONEq(t, `[{"SourceUrl":"https://8.8.8.8/source.mp4"}]`, r.PostForm.Get("URLSets"))
					result = `{"Data":[{"JobId":"upload-job"}]}`
				case "QueryUploadTaskInfo":
					assert.Equal(t, "GET", r.Method)
					assert.Equal(t, "upload-job", r.URL.Query().Get("JobIds"))
					result = `{"Data":{"MediaInfoList":[{"JobId":"upload-job","State":"success","Vid":"video-id","SourceInfo":{"FileId":"source-file"}}]}}`
				case "StartWorkflow":
					assert.Equal(t, "POST", r.Method)
					assert.Equal(t, "workflow-fast-1080", r.URL.Query().Get("TemplateId"))
					assert.NotEmpty(t, r.URL.Query().Get("ClientToken"))
					assert.Zero(t, r.ContentLength)
					result = `{"RunId":"workflow-run"}`
				case "GetWorkflowExecutionResult":
					assert.Equal(t, "GET", r.Method)
					result = `{"Status":"0"}`
				case "GetMediaInfos":
					assert.Equal(t, "video-id", r.URL.Query().Get("Vids"))
					if deleted {
						result = `{"NotExistVids":["video-id"]}`
					} else {
						result = `{"MediaInfoList":[{"SourceInfo":{"FileId":"source-file"}}]}`
					}
				case "UpdateMediaPublishStatus":
					assert.Equal(t, "GET", r.Method)
					assert.Equal(t, "Published", r.URL.Query().Get("Status"))
				case "GetPlayInfo":
					assert.Equal(t, "oe", r.URL.Query().Get("Definition"))
					assert.Equal(t, "H264", r.URL.Query().Get("Codec"))
					encoded, err := common.Marshal(map[string]any{"PlayInfoList": []any{map[string]any{"FileId": "enhanced-file", "Definition": "oe", "Width": scenario.width, "Height": scenario.height, "Format": "mp4", "MainPlayUrl": "https://8.8.4.4/enhanced.mp4"}}})
					require.NoError(t, err)
					result = string(encoded)
				case "DeleteMedia":
					assert.Equal(t, "GET", r.Method)
					assert.Equal(t, "video-id", r.URL.Query().Get("Vids"))
					assert.Empty(t, r.URL.Query().Get("Vid"))
					deleted = true
				default:
					t.Fatalf("unexpected action %s", action)
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"Result":` + result + `}`))}, nil
			})}
			mediaClient := &http.Client{Transport: srTransport(func(r *http.Request) (*http.Response, error) {
				data := video
				if r.URL.Path == "/source.mp4" {
					data = []byte("private original")
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(data))}, nil
			})}
			ssrfProtectedHTTPClient = mediaClient
			httpClient = mediaClient
			for step := 0; step < 12; step++ {
				RunTaskPollingOnce(context.Background(), nil)
				require.NoError(t, model.DB.First(task, task.ID).Error)
				require.NotEqualValues(t, model.TaskStatusFailure, task.Status)
				assert.NotContains(t, string(task.Data), "source.mp4")
				if task.Status == model.TaskStatusSuccess {
					break
				}
			}
			require.EqualValues(t, model.TaskStatusSuccess, task.Status)
			assert.Equal(t, 1, counts["UploadMediaByUrl"])
			assert.Equal(t, 1, counts["StartWorkflow"])
			file, err := OpenVideoSuperResolutionFile(task, false)
			require.NoError(t, err)
			got, err := io.ReadAll(file)
			file.Close()
			require.NoError(t, err)
			assert.Equal(t, video, got)
			original, err := OpenVideoSuperResolutionFile(task, true)
			if preserve {
				require.NoError(t, err)
				got, _ := io.ReadAll(original)
				original.Close()
				assert.Equal(t, "private original", string(got))
			} else {
				assert.ErrorIs(t, err, os.ErrNotExist)
			}
			assert.Equal(t, scenario.width, task.PrivateData.SuperResolution.OutputWidth)
			assert.Equal(t, scenario.height, task.PrivateData.SuperResolution.OutputHeight)
			assert.InDelta(t, 24.0, task.PrivateData.SuperResolution.OutputFPS, 0.001)
			assert.InDelta(t, scenario.estimate, task.PrivateData.SuperResolution.EstimateUSD, 0.000000000001)
			require.True(t, model.HasUnfinishedSyncTasks(), "清理完成前保持调度")
			assert.Equal(t, "requested", task.PrivateData.SuperResolution.CleanupStatus)
			RunTaskPollingOnce(context.Background(), nil)
			require.NoError(t, model.DB.First(task, task.ID).Error)
			assert.Equal(t, "confirmed", task.PrivateData.SuperResolution.CleanupStatus)
			assert.Empty(t, task.PrivateData.SuperResolution.OriginalURL)
			assert.EqualValues(t, model.TaskStatusSuccess, task.Status)
			assert.False(t, model.HasUnfinishedSyncTasks())
		})
	}
}

func TestSuperResolutionUnknownUploadDoesNotResubmitAndRefundsOnce(t *testing.T) {
	truncate(t)
	configureSRTest(t)
	seedUser(t, 510, 10000)
	seedToken(t, 510, 510, "sr-test-token", 7000)
	task := makeTask(510, 1, 4000, 510, BillingSourceWallet, 0)
	task.TaskID = "task_sr_unknown"
	task.PrivateData.SuperResolution = &model.TaskSuperResolutionState{Phase: "upload_submitting", TargetResolution: "1080p", WorkflowID: "workflow-fast-1080"}
	require.NoError(t, model.DB.Create(task).Error)
	old := videoSuperResolutionHTTPClient
	t.Cleanup(func() { videoSuperResolutionHTTPClient = old })
	videoSuperResolutionHTTPClient = &http.Client{Transport: srTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("不得重放不确定的上传")
		return nil, nil
	})}
	RunTaskPollingOnce(context.Background(), nil)
	RunTaskPollingOnce(context.Background(), nil)
	require.NoError(t, model.DB.First(task, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusFailure, task.Status)
	assert.Zero(t, task.Quota)
	assert.Equal(t, 14000, getUserQuota(t, 510))
	assert.Equal(t, 11000, getTokenRemainQuota(t, 510))
	assert.Equal(t, "unknown", task.PrivateData.SuperResolution.CleanupStatus)
}

func TestSuperResolutionConfigChangesProviderResolutionOnlyAndClearsRetry(t *testing.T) {
	configureSRTest(t)
	key := VideoSuperResolutionOptionKeyPrefix + "dreamina-seedance-2-0-260128"
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	old, exists := common.OptionMap[key]
	common.OptionMap[key] = `{"enabled":true,"source_resolution":"480p","preserve_original":false}`
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if exists {
			common.OptionMap[key] = old
		} else {
			delete(common.OptionMap, key)
		}
	})
	c := &gin.Context{}
	body := map[string]any{"model": "dreamina-seedance-2-0-260128", "resolution": "1080p"}
	require.NoError(t, ApplyVideoSuperResolution(c, "doubao", "dreamina-seedance-2-0-260128", "dreamina-seedance-2-0-260128", body))
	assert.Equal(t, "480p", body["resolution"])
	snapshot, ok := GetVideoSuperResolutionSnapshot(c)
	require.True(t, ok)
	assert.Equal(t, "1080p", snapshot.TargetResolution)
	assert.False(t, snapshot.PreserveOriginal)
	ClearVideoSuperResolutionSnapshot(c)
	_, ok = GetVideoSuperResolutionSnapshot(c)
	assert.False(t, ok)
	t.Setenv("BYTEPLUS_VOD_SECRET_KEY", "")
	body["resolution"] = "1080p"
	require.ErrorIs(t, ApplyVideoSuperResolution(c, "doubao", "dreamina-seedance-2-0-260128", "dreamina-seedance-2-0-260128", body), ErrVideoSuperResolutionNotConfigured)
	assert.Equal(t, "1080p", body["resolution"])
}
