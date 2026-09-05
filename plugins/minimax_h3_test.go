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
