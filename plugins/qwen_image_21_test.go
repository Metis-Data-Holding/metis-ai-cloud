package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadQwenImage21Plugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source("qwen-image-21")
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().RegisterFactory(source, jsplugin.Options{Key: "qwen-image-21"})
	require.NoError(t, err)
	return plugin
}

func qwenImage21Map(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(encoded, &decoded))
	return decoded
}

func qwenImage21Decode(t *testing.T, operation string, body map[string]any) (map[string]any, error) {
	t.Helper()
	plugin := loadQwenImage21Plugin(t)
	value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "decodeRequest"}, map[string]any{
		"operation": operation,
		"model":     "qwen-image-2.1",
		"body":      map[string]any{"kind": "json", "value": body},
	})
	if err != nil {
		return nil, err
	}
	return qwenImage21Map(t, value), nil
}

func qwenImage21History() map[string]any {
	return map[string]any{
		"prompt-1": map[string]any{
			"status": map[string]any{"status_str": "success", "completed": true},
			"outputs": map[string]any{
				"461": map[string]any{"images": []any{map[string]any{"filename": "Qwen_image_2.1_00001.png", "subfolder": "", "type": "output"}}},
			},
		},
	}
}

func TestQwenImage21OpenAIImageDecodeAndWorkflow(t *testing.T) {
	plugin := loadQwenImage21Plugin(t)
	assert.Equal(t, "qwen-image-21", plugin.Meta.Key)
	assert.Equal(t, []string{"qwen-image-2.1"}, plugin.Meta.Models)
	assert.Contains(t, plugin.Meta.RequiredCapabilities, jsplugin.CapabilityImageArtifacts)
	assert.Equal(t, "count", plugin.Meta.UsageSchema["image_count"].Unit)

	intent, err := qwenImage21Decode(t, "generate", map[string]any{
		"model": "qwen-image-2.1", "prompt": "a cat by a window", "negative_prompt": "blurry", "size": "1024x1024", "n": 1, "seed": 42,
	})
	require.NoError(t, err)
	assert.Equal(t, "submit", intent["kind"])
	assert.Equal(t, "text_to_image", intent["action"])

	requestBody := intent["requestBody"].(map[string]any)
	assert.Equal(t, "a cat by a window", requestBody["prompt"])
	assert.Equal(t, float64(1), requestBody["n"])

	submit, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"baseUrl": "http://127.0.0.1:8191", "publicTaskId": "task-public", "requestBody": requestBody,
	})
	require.NoError(t, err)
	submitMap := qwenImage21Map(t, submit)
	assert.Equal(t, "http://127.0.0.1:8191/prompt", submitMap["url"])
	payload := submitMap["body"].(map[string]any)
	workflow := payload["prompt"].(map[string]any)
	assert.Equal(t, "qwen_image_2.1_bf16.safetensors", workflow["451"].(map[string]any)["inputs"].(map[string]any)["unet_name"])
	assert.Equal(t, "qwen3vl_8b_bf16.safetensors", workflow["453"].(map[string]any)["inputs"].(map[string]any)["clip_name"])
	assert.Equal(t, "qwen_image_2.1_vae_bf16.safetensors", workflow["454"].(map[string]any)["inputs"].(map[string]any)["vae_name"])
	assert.Equal(t, "SaveImageAdvanced", workflow["461"].(map[string]any)["class_type"])
	assert.Equal(t, "QwenImage21Cache", workflow["480"].(map[string]any)["class_type"])
	kSampler := workflow["458"].(map[string]any)["inputs"].(map[string]any)
	assert.Equal(t, float64(25), kSampler["steps"])
	assert.Equal(t, float64(1), kSampler["cfg"])
	assert.Equal(t, "euler", kSampler["sampler_name"])
}

func TestQwenImage21OpenAIImageRejectsUnsupportedRequests(t *testing.T) {
	cases := []struct {
		name, operation, message string
		body                     map[string]any
	}{
		{"edits", "edit", "image edits are not supported", map[string]any{"prompt": "cat"}},
		{"empty prompt", "generate", "prompt is required", map[string]any{"prompt": " "}},
		{"multiple images", "generate", "n must be 1", map[string]any{"prompt": "cat", "n": 2}},
		{"unsupported size", "generate", "size must be 1024x1024", map[string]any{"prompt": "cat", "size": "512x512"}},
		{"input image", "generate", "image inputs are not supported", map[string]any{"prompt": "cat", "image": "https://example.com/cat.png"}},
		{"bad format", "generate", "response_format must be url or b64_json", map[string]any{"prompt": "cat", "response_format": "json"}},
		{"unsafe seed", "generate", "seed must be a non-negative safe integer", map[string]any{"prompt": "cat", "seed": 9007199254740992}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := qwenImage21Decode(t, test.operation, test.body)
			require.ErrorContains(t, err, test.message)
		})
	}
}

func TestQwenImage21ComfyResultsAndArtifactRequest(t *testing.T) {
	plugin := loadQwenImage21Plugin(t)
	history := qwenImage21History()

	result, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "prompt-1"}, history)
	require.NoError(t, err)
	assert.Equal(t, "SUCCESS", qwenImage21Map(t, result)["status"])

	artifacts, err := plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"status": "SUCCESS", "data": history})
	require.NoError(t, err)
	artifactList := artifacts.([]any)
	require.Len(t, artifactList, 1)
	assert.Equal(t, "image", artifactList[0].(map[string]any)["key"])

	descriptor, err := plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{
		"artifactKey": "image", "data": history, "baseUrl": "http://127.0.0.1:8191", "clientRequest": map[string]any{"method": "GET"},
	})
	require.NoError(t, err)
	descriptorMap := qwenImage21Map(t, descriptor)
	assert.Equal(t, "http://127.0.0.1:8191/view?filename=Qwen_image_2.1_00001.png&subfolder=&type=output", descriptorMap["url"])
	assert.Equal(t, true, descriptorMap["credentialless"])

	rendered, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_image", "render"}, map[string]any{
		"artifacts": map[string]any{"image": map[string]any{"url": "https://gateway.example/v1/tasks/task-1/artifacts/image/content?access=cap"}},
	}, map[string]any{})
	require.NoError(t, err)
	renderedMap := qwenImage21Map(t, rendered)
	data := renderedMap["data"].([]any)
	assert.Equal(t, "https://gateway.example/v1/tasks/task-1/artifacts/image/content?access=cap", data[0].(map[string]any)["url"])
}

func TestQwenImage21ComfyFailuresDoNotReportSuccess(t *testing.T) {
	plugin := loadQwenImage21Plugin(t)
	missingOutput := qwenImage21History()
	delete(missingOutput["prompt-1"].(map[string]any)["outputs"].(map[string]any), "461")
	result, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "prompt-1"}, missingOutput)
	require.NoError(t, err)
	parsed := qwenImage21Map(t, result)
	assert.Equal(t, "FAILURE", parsed["status"])
	assert.Equal(t, "image output is missing", parsed["reason"])

	interrupted := qwenImage21History()
	interrupted["prompt-1"].(map[string]any)["status"] = map[string]any{"status_str": "error", "completed": true}
	result, err = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "prompt-1"}, interrupted)
	require.NoError(t, err)
	assert.Equal(t, "FAILURE", qwenImage21Map(t, result)["status"])
}

func TestQwenImage21ComfySubmitAndUnknownStates(t *testing.T) {
	plugin := loadQwenImage21Plugin(t)
	_, err := plugin.Engine.Call(t.Context(), "parseSubmitResponse", map[string]any{}, map[string]any{
		"body": map[string]any{"node_errors": map[string]any{"461": map[string]any{"errors": []any{"invalid"}}}},
	})
	require.ErrorContains(t, err, "ComfyUI rejected the workflow")

	parsed, err := plugin.Engine.Call(t.Context(), "parseSubmitResponse", map[string]any{}, map[string]any{
		"body": map[string]any{"prompt_id": "prompt-1"},
	})
	require.NoError(t, err)
	assert.Equal(t, "prompt-1", qwenImage21Map(t, parsed)["taskId"])

	result, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "prompt-1"}, map[string]any{})
	require.NoError(t, err)
	assert.Equal(t, "IN_PROGRESS", qwenImage21Map(t, result)["status"])

	result, err = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "wrong-task"}, qwenImage21History())
	require.NoError(t, err)
	assert.Equal(t, "UNKNOWN", qwenImage21Map(t, result)["status"])

	unknownStatus := qwenImage21History()
	unknownStatus["prompt-1"].(map[string]any)["status"] = map[string]any{"status_str": "mystery"}
	result, err = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "prompt-1"}, unknownStatus)
	require.NoError(t, err)
	assert.Equal(t, "UNKNOWN", qwenImage21Map(t, result)["status"])
}
