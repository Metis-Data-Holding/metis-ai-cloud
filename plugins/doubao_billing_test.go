package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadDoubaoPlugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source("doubao")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "doubao"})
	require.NoError(t, err)
	return plugin
}

func callDoubaoUsage(t *testing.T, plugin *jsplugin.LoadedPlugin, model, upstreamModel string, content []any) map[string]any {
	t.Helper()
	value, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
		"model":         model,
		"upstreamModel": upstreamModel,
		"requestBody": map[string]any{
			"seconds": float64(5),
			"metadata": map[string]any{
				"resolution": "720p",
				"content":    content,
			},
		},
	})
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var facts map[string]any
	require.NoError(t, common.Unmarshal(encoded, &facts))
	return facts
}

func TestDoubaoBytePlusSubmitUsage(t *testing.T) {
	plugin := loadDoubaoPlugin(t)
	videoContent := []any{map[string]any{
		"type":      "video_url",
		"video_url": map[string]any{"url": "https://cdn.example/reference.mp4"},
	}}

	t.Run("Dreamina text to video keeps output-only estimate", func(t *testing.T) {
		facts := callDoubaoUsage(t, plugin, "dreamina-seedance-2-0-260128", "dreamina-seedance-2.0", nil)
		assert.EqualValues(t, 108000, facts["tokens"])
		assert.Equal(t, "none", facts["video_input"])
	})

	t.Run("Dreamina video input reserves official maximum input duration", func(t *testing.T) {
		facts := callDoubaoUsage(t, plugin, "dreamina-seedance-2-0-260128", "dreamina-seedance-2.0", videoContent)
		assert.EqualValues(t, 432000, facts["tokens"])
		assert.Equal(t, "video", facts["video_input"])
	})

	t.Run("Dreamina Fast mapped name reserves official maximum input duration", func(t *testing.T) {
		facts := callDoubaoUsage(t, plugin, "dreamina-seedance-2-0-fast-260128", "dreamina-seedance-2.0-fast", videoContent)
		assert.EqualValues(t, 432000, facts["tokens"])
		assert.Equal(t, "video", facts["video_input"])
	})

	t.Run("Doubao video input keeps existing estimate", func(t *testing.T) {
		facts := callDoubaoUsage(t, plugin, "doubao-seedance-2-0-260128", "doubao-seedance-2-0-260128", videoContent)
		assert.EqualValues(t, 108000, facts["tokens"])
		assert.Equal(t, "video", facts["video_input"])
	})
}

func TestDoubaoExplicitResolutionUsesNormalizedBillingTier(t *testing.T) {
	plugin := loadDoubaoPlugin(t)
	videoContent := []any{map[string]any{
		"type":      "video_url",
		"video_url": map[string]any{"url": "https://cdn.example/reference.mp4"},
	}}

	decoded, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_responses", "decodeRequest"}, map[string]any{
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model":      "doubao-seedance-2-0-260128",
			"input":      "animate the reference video",
			"resolution": "1920x1080",
			"metadata":   map[string]any{"content": videoContent},
		}},
	})
	require.NoError(t, err)
	requestBody := alibabaObject(t, decoded)["requestBody"].(map[string]any)
	metadata := requestBody["metadata"].(map[string]any)
	assert.Equal(t, "1080p", metadata["resolution"])
	descriptor, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"baseUrl":       "https://provider.example",
		"apiKey":        "test-key",
		"upstreamModel": "doubao-seedance-2-0-260128",
		"requestBody":   requestBody,
	})
	require.NoError(t, err)
	assert.Equal(t, "1080p", alibabaObject(t, descriptor)["body"].(map[string]any)["resolution"])

	usage, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
		"model":         "doubao-seedance-2-0-260128",
		"upstreamModel": "doubao-seedance-2-0-260128",
		"usagePurpose":  "billing_ratios",
		"requestBody":   requestBody,
	})
	require.NoError(t, err)
	assert.InDelta(t, 31.0/46.0, alibabaObject(t, usage)["video_input_ratio"], 1e-12)
}

func TestDoubaoVideoSizeUsesNormalizedBillingTier(t *testing.T) {
	plugin := loadDoubaoPlugin(t)
	videoContent := []any{map[string]any{
		"type":      "video_url",
		"video_url": map[string]any{"url": "https://cdn.example/reference.mp4"},
	}}

	decoded, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
		"model": "doubao-seedance-2-0-260128",
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model":           "doubao-seedance-2-0-260128",
			"input_reference": "https://cdn.example/reference.mp4",
			"size":            "1920x1080",
			"metadata":        map[string]any{"content": videoContent},
		}},
	})
	require.NoError(t, err)
	requestBody := alibabaObject(t, decoded)["requestBody"].(map[string]any)

	usage, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
		"model":         "doubao-seedance-2-0-260128",
		"upstreamModel": "doubao-seedance-2-0-260128",
		"usagePurpose":  "billing_ratios",
		"requestBody":   requestBody,
	})
	require.NoError(t, err)
	assert.InDelta(t, 31.0/46.0, alibabaObject(t, usage)["video_input_ratio"], 1e-12)
}

func TestDoubaoBytePlusCompletionUsage(t *testing.T) {
	plugin := loadDoubaoPlugin(t)
	body := map[string]any{
		"status": "succeeded",
		"usage": map[string]any{
			"completion_tokens": float64(654321),
			"total_tokens":      float64(700000),
		},
		"content": map[string]any{"resolution": "720p"},
	}
	value, err := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", nil, map[string]any{}, body)
	require.NoError(t, err)
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var facts map[string]any
	require.NoError(t, common.Unmarshal(encoded, &facts))

	assert.EqualValues(t, 654321, facts["tokens"])
	assert.Equal(t, "720p", facts["resolution"])
}

func TestDoubaoBytePlusTerminalFailure(t *testing.T) {
	plugin := loadDoubaoPlugin(t)
	for _, status := range []string{"cancelled", "expired"} {
		t.Run(status, func(t *testing.T) {
			value, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{}, map[string]any{"status": status})
			require.NoError(t, err)
			encoded, err := common.Marshal(value)
			require.NoError(t, err)
			var result map[string]any
			require.NoError(t, common.Unmarshal(encoded, &result))

			assert.Equal(t, "FAILURE", result["status"])
			assert.Equal(t, "100%", result["progress"])
			assert.Equal(t, status, result["reason"])
		})
	}
}
