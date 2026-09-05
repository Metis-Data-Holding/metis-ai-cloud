package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadMinimaxH3Plugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source("minimax-h3")
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().RegisterFactory(source, jsplugin.Options{Key: "minimax-h3"})
	require.NoError(t, err)
	return plugin
}

func minimaxH3Map(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(encoded, &decoded))
	return decoded
}

func callMinimaxH3Hook(t *testing.T, plugin *jsplugin.LoadedPlugin, hook string, args ...any) map[string]any {
	t.Helper()
	value, err := plugin.Engine.Call(t.Context(), hook, args...)
	require.NoError(t, err)
	return minimaxH3Map(t, value)
}

func minimaxH3SubmitContext(requestBody map[string]any, publicTaskID string) map[string]any {
	return map[string]any{
		"requestBody":   requestBody,
		"model":         "minimax-h3-fl2va",
		"upstreamModel": "minimax-h3-fl2va",
		"baseUrl":       "http://100.64.0.10:8888",
		"publicTaskId":  publicTaskID,
	}
}

func TestMinimaxH3OpenAIVideoDecode(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)
	decode := func(body map[string]any) (map[string]any, error) {
		value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "minimax-h3-fl2va",
			"body":  map[string]any{"kind": "json", "value": body},
		})
		if err != nil {
			return nil, err
		}
		return minimaxH3Map(t, value), nil
	}

	intent, err := decode(map[string]any{
		"model":    "minimax-h3-fl2va",
		"prompt":   "city at night",
		"seconds":  7,
		"metadata": map[string]any{"resolution": "768p", "ratio": "9:16", "generate_audio": false},
	})
	require.NoError(t, err)
	assert.Equal(t, "submit", intent["kind"])
	assert.Equal(t, "text_to_video", intent["action"])
	request := intent["requestBody"].(map[string]any)
	assert.Equal(t, "city at night", request["prompt"])
	assert.EqualValues(t, 7, request["duration"])
	assert.Equal(t, false, request["generate_audio"])

	tests := []struct {
		name string
		body map[string]any
		err  string
	}{
		{"empty prompt", map[string]any{"prompt": " "}, "prompt is required"},
		{"short duration", map[string]any{"prompt": "p", "seconds": 4}, "duration must be an integer between 5 and 15"},
		{"long duration", map[string]any{"prompt": "p", "seconds": 16}, "duration must be an integer between 5 and 15"},
		{"fractional duration", map[string]any{"prompt": "p", "seconds": 5.5}, "duration must be an integer between 5 and 15"},
		{"unsupported resolution", map[string]any{"prompt": "p", "metadata": map[string]any{"resolution": "720p"}}, "resolution must be 768p"},
		{"unsupported ratio", map[string]any{"prompt": "p", "metadata": map[string]any{"ratio": "21:9"}}, "ratio must be one of"},
		{"reference content", map[string]any{"prompt": "p", "metadata": map[string]any{"content": []any{map[string]any{"type": "image_url"}}}}, "reference content is not supported"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, callErr := decode(test.body)
			require.ErrorContains(t, callErr, test.err)
		})
	}
}

func TestMinimaxH3BuildsMinimalComfyWorkflow(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)
	ratioSizes := map[string][2]int{
		"16:9": {1344, 768},
		"9:16": {768, 1344},
		"1:1":  {768, 768},
		"4:3":  {1024, 768},
		"3:4":  {768, 1024},
	}
	for ratio, size := range ratioSizes {
		t.Run(ratio, func(t *testing.T) {
			descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", minimaxH3SubmitContext(map[string]any{
				"prompt": "city at night", "duration": 5, "resolution": "768p", "ratio": ratio, "generate_audio": false,
			}, "task-a"))
			assert.Equal(t, "http://100.64.0.10:8888/prompt", descriptor["url"])
			assert.Equal(t, "POST", descriptor["method"])
			body := descriptor["body"].(map[string]any)
			workflow := body["prompt"].(map[string]any)
			input := workflow["4"].(map[string]any)["inputs"].(map[string]any)
			assert.EqualValues(t, size[0], input["width"])
			assert.EqualValues(t, size[1], input["height"])
			assert.EqualValues(t, 124, input["length"])
			assert.Equal(t, "city at night", input["prompt"])
			assert.NotContains(t, workflow, "13")
			assert.NotContains(t, workflow["11"].(map[string]any)["inputs"], "audio")
			assert.Equal(t, "minimax_h3_fl2va_pruned_int8_convrot.safetensors", workflow["1"].(map[string]any)["inputs"].(map[string]any)["unet_name"])
			assert.EqualValues(t, 20, workflow["7"].(map[string]any)["inputs"].(map[string]any)["steps"])
		})
	}

	t.Run("audio nodes are present only when enabled", func(t *testing.T) {
		descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", minimaxH3SubmitContext(map[string]any{
			"prompt": "p", "duration": 15, "resolution": "768p", "ratio": "16:9", "generate_audio": true,
		}, "task-a"))
		workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
		assert.Contains(t, workflow, "13")
		assert.Contains(t, workflow, "14")
		assert.Contains(t, workflow["11"].(map[string]any)["inputs"], "audio")
		assert.EqualValues(t, 362, workflow["4"].(map[string]any)["inputs"].(map[string]any)["length"])
	})

	t.Run("seed is stable per public task", func(t *testing.T) {
		request := map[string]any{"prompt": "p", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false}
		seed := func(taskID string) any {
			descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", minimaxH3SubmitContext(request, taskID))
			workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
			return workflow["5"].(map[string]any)["inputs"].(map[string]any)["noise_seed"]
		}
		assert.Equal(t, seed("task-a"), seed("task-a"))
		assert.NotEqual(t, seed("task-a"), seed("task-b"))
	})
}

func minimaxH3History(taskID, status string, completed bool, output any) map[string]any {
	entry := map[string]any{
		"status": map[string]any{"status_str": status, "completed": completed},
	}
	if output != nil {
		entry["outputs"] = map[string]any{"12": output}
	}
	return map[string]any{taskID: entry}
}

func TestMinimaxH3TaskLifecycle(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)

	t.Run("submit and query", func(t *testing.T) {
		parsed := callMinimaxH3Hook(t, plugin, "parseSubmitResponse", map[string]any{}, map[string]any{
			"body": map[string]any{"prompt_id": "prompt/one", "number": 1},
		})
		assert.Equal(t, "prompt/one", parsed["taskId"])

		query := callMinimaxH3Hook(t, plugin, "buildQueryRequest", map[string]any{
			"baseUrl": "http://100.64.0.10:8888/", "taskId": "prompt/one",
		})
		assert.Equal(t, "http://100.64.0.10:8888/history/prompt%2Fone", query["url"])
		assert.Equal(t, "GET", query["method"])
	})

	t.Run("submit rejects an invalid response", func(t *testing.T) {
		_, err := plugin.Engine.Call(t.Context(), "parseSubmitResponse", map[string]any{}, map[string]any{
			"body": map[string]any{"node_errors": map[string]any{"4": map[string]any{"errors": []any{"bad input"}}}},
		})
		require.ErrorContains(t, err, "ComfyUI rejected the workflow")
	})

	tests := []struct {
		name       string
		body       map[string]any
		wantStatus string
		wantReason string
	}{
		{"empty history", map[string]any{}, "IN_PROGRESS", ""},
		{"running", minimaxH3History("p1", "running", false, nil), "IN_PROGRESS", ""},
		{"success", minimaxH3History("p1", "success", true, map[string]any{"animated": []any{map[string]any{
			"filename": "MiniMaxH3_00001-audio.mp4", "subfolder": "", "type": "output", "format": "video/h264-mp4",
		}}}), "SUCCESS", ""},
		{"success without video", minimaxH3History("p1", "success", true, map[string]any{}), "FAILURE", "video output is missing"},
		{"error", minimaxH3History("p1", "error", false, nil), "FAILURE", "ComfyUI task failed"},
		{"unknown task", map[string]any{"other": map[string]any{}}, "UNKNOWN", "unrecognized ComfyUI history"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := callMinimaxH3Hook(t, plugin, "parseTaskResult", map[string]any{"taskId": "p1"}, test.body)
			assert.Equal(t, test.wantStatus, result["status"])
			if test.wantReason != "" {
				assert.Contains(t, result["reason"], test.wantReason)
			}
			if test.wantStatus == "SUCCESS" {
				assert.Equal(t, "100%", result["progress"])
			}
		})
	}
}

func TestMinimaxH3ArtifactProxyAndUsage(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)
	history := minimaxH3History("p1", "success", true, map[string]any{"animated": []any{map[string]any{
		"filename": "MiniMaxH3 00001.mp4", "subfolder": "h3/output", "type": "output", "format": "video/h264-mp4",
	}}})

	value, err := plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"status": "SUCCESS", "data": history})
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var artifacts []map[string]any
	require.NoError(t, common.Unmarshal(encoded, &artifacts))
	require.Len(t, artifacts, 1)
	assert.Equal(t, map[string]any{"key": "video", "type": "video", "mimeType": "video/mp4"}, artifacts[0])

	descriptor := callMinimaxH3Hook(t, plugin, "buildContentRequest", map[string]any{
		"baseUrl": "http://100.64.0.10:8888/", "upstreamTaskId": "p1", "artifactKey": "video", "data": history,
		"clientRequest": map[string]any{"method": "HEAD"},
	})
	assert.Equal(t, "HEAD", descriptor["method"])
	assert.Equal(t, "http://100.64.0.10:8888/view?filename=MiniMaxH3%2000001.mp4&subfolder=h3%2Foutput&type=output", descriptor["url"])
	assert.Equal(t, true, descriptor["credentialless"])

	usage := callMinimaxH3Hook(t, plugin, "extractUsage", minimaxH3SubmitContext(map[string]any{
		"prompt": "p", "duration": 7, "resolution": "768p", "ratio": "16:9", "generate_audio": true,
	}, "task-a"))
	assert.EqualValues(t, 7, usage["seconds"])
	assert.Equal(t, "768p", usage["resolution"])
	assert.Equal(t, true, usage["generate_audio"])
}
