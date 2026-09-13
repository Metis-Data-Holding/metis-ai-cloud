package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
)

const bytePlusVODAPIEndpoint = "https://vod.byteplusapi.com"

const bytePlusVODAPIVersion = "2023-01-01"

type VideoSuperResolutionVODClient struct {
	HTTPClient *http.Client
	Endpoint   string
	Runtime    VideoSuperResolutionRuntimeConfig
}

// DeleteMedia 异步执行，只有查询确认 Vid 不存在才能标记清理完成。
var ErrVideoSuperResolutionMediaNotFound = errors.New("BytePlus VOD media not found")

type VideoSuperResolutionUpload struct {
	JobID string
}

type VideoSuperResolutionUploadTask struct {
	State  string
	VID    string
	FileID string
}
type VideoSuperResolutionWorkflow struct{ RunID string }
type VideoSuperResolutionWorkflowResult struct{ Status string }
type VideoSuperResolutionMedia struct{ FileID string }

type VideoSuperResolutionPlayInfo struct {
	FileID      string
	MainPlayURL string
	Width       int
	Height      int
	Format      string
}

var videoSuperResolutionHTTPClient = &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func NewVideoSuperResolutionVODClient(runtime VideoSuperResolutionRuntimeConfig) *VideoSuperResolutionVODClient {
	return &VideoSuperResolutionVODClient{
		HTTPClient: videoSuperResolutionHTTPClient,
		Endpoint:   bytePlusVODAPIEndpoint,
		Runtime:    runtime,
	}
}

func (client *VideoSuperResolutionVODClient) call(ctx context.Context, action, method string, queryValues url.Values, formEncoded bool, payload map[string]any) (map[string]any, error) {
	if client == nil || client.HTTPClient == nil {
		return nil, errors.New("video super-resolution VOD client is not initialized")
	}
	endpoint, err := url.Parse(client.Endpoint)
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" {
		return nil, errors.New("video super-resolution VOD endpoint is invalid")
	}
	query := endpoint.Query()
	query.Set("Action", action)
	query.Set("Version", bytePlusVODAPIVersion)
	for key, values := range queryValues {
		if len(values) > 0 {
			query.Set(key, values[0])
		}
	}
	endpoint.RawQuery = query.Encode()
	var body []byte
	var requestBody io.Reader
	contentType := ""
	if formEncoded {
		values, err := bytePlusVODQuery(payload)
		if err != nil {
			return nil, err
		}
		body = []byte(values.Encode())
		requestBody = bytes.NewReader(body)
		contentType = "application/x-www-form-urlencoded"
	}

	signHeaders := make(map[string]string, 1)
	if contentType != "" {
		signHeaders["Content-Type"] = contentType
	}
	signed, err := jsplugin.SignVolcV4(jsplugin.VolcSignRequest{
		Method:    method,
		URL:       endpoint.String(),
		Headers:   signHeaders,
		Body:      string(body),
		AccessKey: client.Runtime.AccessKey,
		SecretKey: client.Runtime.SecretKey,
		Region:    client.Runtime.Region,
		Service:   "vod",
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint.String(), requestBody)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for name, value := range signed {
		req.Header.Set(name, value)
	}
	resp, err := client.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	var response map[string]any
	if err := common.Unmarshal(responseBody, &response); err != nil {
		return nil, fmt.Errorf("invalid BytePlus VOD response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, bytePlusVODResponseError(resp.StatusCode, response)
	}
	if metadata, _ := response["ResponseMetadata"].(map[string]any); metadata != nil {
		if errInfo, _ := metadata["Error"].(map[string]any); errInfo != nil {
			return nil, fmt.Errorf("BytePlus VOD %s: %s", stringValue(errInfo["Code"]), "request rejected")
		}
	}
	return response, nil
}

func bytePlusVODQuery(payload map[string]any) (url.Values, error) {
	values := make(url.Values, len(payload))
	for key, value := range payload {
		if value == nil {
			continue
		}
		if list, ok := value.([]string); ok {
			values.Set(key, strings.Join(list, ","))
			continue
		}
		text, ok := value.(string)
		if !ok {
			encoded, err := common.Marshal(value)
			if err != nil {
				return nil, err
			}
			text = string(encoded)
		}
		values.Set(key, text)
	}
	return values, nil
}

func (client *VideoSuperResolutionVODClient) callQuery(ctx context.Context, action string, payload map[string]any) (map[string]any, error) {
	query, err := bytePlusVODQuery(payload)
	if err != nil {
		return nil, err
	}
	return client.call(ctx, action, http.MethodGet, query, false, nil)
}

func bytePlusVODResponseError(status int, response map[string]any) error {
	metadata, _ := response["ResponseMetadata"].(map[string]any)
	errInfo, _ := metadata["Error"].(map[string]any)
	code, message := stringValue(errInfo["Code"]), "request rejected"
	if code == "" {
		code = "http_error"
	}
	if message == "" {
		message = http.StatusText(status)
	}
	return fmt.Errorf("BytePlus VOD %s: %s", code, message)
}

func (client *VideoSuperResolutionVODClient) UploadMediaByURL(ctx context.Context, sourceURL string) (VideoSuperResolutionUpload, error) {
	response, err := client.call(ctx, "UploadMediaByUrl", http.MethodPost, nil, true, map[string]any{
		"SpaceName": client.Runtime.SpaceName,
		// 由 VOD 随机命名，避免不同任务覆盖同一个存储对象。
		"URLSets": []map[string]any{{"SourceUrl": sourceURL}},
	})
	if err != nil {
		return VideoSuperResolutionUpload{}, err
	}
	data := anySlice(response["Data"])
	if len(data) == 0 {
		result := nestedMap(response, "Result")
		data = anySlice(result["Data"])
	}
	if len(data) == 0 {
		return VideoSuperResolutionUpload{}, errors.New("BytePlus VOD upload returned no job")
	}
	item, _ := data[0].(map[string]any)
	jobID := stringValue(item["JobId"])
	if jobID == "" {
		return VideoSuperResolutionUpload{}, errors.New("BytePlus VOD upload returned no job id")
	}
	return VideoSuperResolutionUpload{JobID: jobID}, nil
}

func (client *VideoSuperResolutionVODClient) QueryUploadTaskInfo(ctx context.Context, jobID string) (VideoSuperResolutionUploadTask, error) {
	response, err := client.callQuery(ctx, "QueryUploadTaskInfo", map[string]any{"JobIds": jobID})
	if err != nil {
		return VideoSuperResolutionUploadTask{}, err
	}
	data := nestedMap(nestedMap(response, "Result"), "Data")
	for _, raw := range anySlice(data["MediaInfoList"]) {
		item := anyMap(raw)
		if stringValue(item["JobId"]) != jobID {
			continue
		}
		source := anyMap(item["SourceInfo"])
		return VideoSuperResolutionUploadTask{State: stringValue(item["State"]), VID: stringValue(item["Vid"]), FileID: stringValue(source["FileId"])}, nil
	}
	for _, missing := range anySlice(data["NotExistJobIds"]) {
		if stringValue(missing) == jobID {
			return VideoSuperResolutionUploadTask{}, ErrVideoSuperResolutionMediaNotFound
		}
	}
	return VideoSuperResolutionUploadTask{}, errors.New("BytePlus VOD upload status returned no matching job")
}

func (client *VideoSuperResolutionVODClient) StartWorkflow(ctx context.Context, vid, clientToken string) (VideoSuperResolutionWorkflow, error) {
	query, err := bytePlusVODQuery(map[string]any{
		"Vid":         vid,
		"TemplateId":  client.Runtime.WorkflowID,
		"ClientToken": clientToken,
	})
	if err != nil {
		return VideoSuperResolutionWorkflow{}, err
	}
	response, err := client.call(ctx, "StartWorkflow", http.MethodPost, query, false, nil)
	if err != nil {
		return VideoSuperResolutionWorkflow{}, err
	}
	runID := stringValue(nestedMap(response, "Result")["RunId"])
	if runID == "" {
		return VideoSuperResolutionWorkflow{}, errors.New("BytePlus VOD workflow returned no run id")
	}
	return VideoSuperResolutionWorkflow{RunID: runID}, nil
}

func (client *VideoSuperResolutionVODClient) GetWorkflowExecutionResult(ctx context.Context, runID string) (VideoSuperResolutionWorkflowResult, error) {
	response, err := client.callQuery(ctx, "GetWorkflowExecutionResult", map[string]any{"RunId": runID})
	if err != nil {
		return VideoSuperResolutionWorkflowResult{}, err
	}
	result := nestedMap(response, "Result")
	status := strings.ToLower(firstString(result["Status"], result["State"]))
	return VideoSuperResolutionWorkflowResult{Status: status}, nil
}

func (client *VideoSuperResolutionVODClient) GetMediaInfos(ctx context.Context, vid string) ([]VideoSuperResolutionMedia, error) {
	response, err := client.callQuery(ctx, "GetMediaInfos", map[string]any{"Vids": vid})
	if err != nil {
		return nil, err
	}
	result := nestedMap(response, "Result")
	for _, missing := range anySlice(result["NotExistVids"]) {
		if stringValue(missing) == vid {
			return nil, ErrVideoSuperResolutionMediaNotFound
		}
	}
	items := anySlice(result["MediaInfoList"])
	if len(items) == 0 {
		return nil, errors.New("BytePlus VOD media response is empty")
	}
	media := make([]VideoSuperResolutionMedia, 0, len(items))
	for _, raw := range items {
		item := anyMap(raw)
		source := anyMap(item["SourceInfo"])
		media = append(media, VideoSuperResolutionMedia{FileID: firstString(source["FileId"], item["FileId"])})
	}
	return media, nil
}

func (client *VideoSuperResolutionVODClient) UpdateMediaPublishStatus(ctx context.Context, vid string) error {
	_, err := client.callQuery(ctx, "UpdateMediaPublishStatus", map[string]any{"Vid": vid, "Status": "Published"})
	return err
}

func (client *VideoSuperResolutionVODClient) GetPlayInfo(ctx context.Context, vid string) ([]VideoSuperResolutionPlayInfo, error) {
	response, err := client.callQuery(ctx, "GetPlayInfo", map[string]any{"Vid": vid, "Definition": "oe", "Format": "mp4", "Codec": "H264", "Ssl": "1"})
	if err != nil {
		return nil, err
	}
	result := nestedMap(response, "Result")
	items := anySlice(result["PlayInfoList"])
	playInfo := make([]VideoSuperResolutionPlayInfo, 0, len(items))
	for _, raw := range items {
		item := anyMap(raw)
		playInfo = append(playInfo, VideoSuperResolutionPlayInfo{
			FileID: stringValue(item["FileId"]), MainPlayURL: firstString(item["MainPlayUrl"], item["MainUrl"]),
			Width: firstInt(item["Width"]), Height: firstInt(item["Height"]), Format: stringValue(item["Format"]),
		})
	}
	return playInfo, nil
}

func (client *VideoSuperResolutionVODClient) DeleteMedia(ctx context.Context, vid string) error {
	_, err := client.callQuery(ctx, "DeleteMedia", map[string]any{"Vids": vid})
	return err
}

func nestedMap(value map[string]any, key string) map[string]any {
	result, _ := value[key].(map[string]any)
	return result
}

func anySlice(value any) []any {
	items, _ := value.([]any)
	return items
}

func anyMap(value any) map[string]any {
	item, _ := value.(map[string]any)
	return item
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func firstString(values ...any) string {
	for _, value := range values {
		if text := stringValue(value); text != "" {
			return text
		}
	}
	return ""
}

func firstInt(values ...any) int {
	for _, value := range values {
		switch item := value.(type) {
		case float64:
			return int(item)
		case int:
			return item
		case string:
			if parsed, err := strconv.Atoi(item); err == nil {
				return parsed
			}
		}
	}
	return 0
}
