package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDoubaoDeclaresBytePlusDreaminaModels(t *testing.T) {
	source, err := builtinplugins.Source("doubao")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "doubao"})
	require.NoError(t, err)

	for _, model := range []string{
		"dreamina-seedance-2-0-260128",
		"dreamina-seedance-2-0-fast-260128",
	} {
		binding, found := registry.Generation().LookupEndpoint("POST", "/v1/responses", model)
		require.True(t, found, model)
		assert.Same(t, plugin, binding.Plugin)
		assert.Equal(t, "openai_responses", binding.Protocol)
	}
}

func TestDoubaoResponsesProtocol(t *testing.T) {
	testVideoResponsesProtocol(t, videoResponsesTestCase{
		pluginKey: "doubao",
		model:     "doubao-seedance-2-0-260128",
		requestBody: map[string]any{
			"model": "doubao-seedance-2-0-260128",
			"input": []any{map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "input_text", "text": "a running fox"},
				map[string]any{"type": "input_image", "image_url": "https://cdn.example/frame.png"},
			}}},
			"seconds": 6,
			"size":    "1920x1080",
		},
		wantAction: "image_to_video",
		wantRequest: map[string]any{
			"model":   "doubao-seedance-2-0-260128",
			"prompt":  "a running fox",
			"images":  []any{"https://cdn.example/frame.png"},
			"seconds": float64(6),
			"metadata": map[string]any{
				"resolution": "1080p",
			},
		},
		wantUsageKeys:  []string{"resolution", "tokens", "video_input"},
		wantVendorName: "doubao",
	})
}

func TestDoubaoVideoSubmitPreservesReferenceRoles(t *testing.T) {
	plugin := loadDoubaoPlugin(t)
	content := []any{
		map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": "data:image/png;base64,AAAA"},
			"role":      "first_frame",
		},
		map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": "data:image/png;base64,BBBB"},
			"role":      "last_frame",
		},
	}

	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"baseUrl":       "https://operator.example",
		"apiKey":        "test-key",
		"upstreamModel": "dreamina-seedance-2.0-fast",
		"requestBody": map[string]any{
			"model":   "dreamina-seedance-2-0-fast-260128",
			"prompt":  "a smooth transition",
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
	var request map[string]any
	require.NoError(t, common.Unmarshal(encoded, &request))
	body, ok := request["body"].(map[string]any)
	require.True(t, ok)
	actualContent, ok := body["content"].([]any)
	require.True(t, ok)
	require.Len(t, actualContent, 3)
	assert.Equal(t, "first_frame", actualContent[0].(map[string]any)["role"])
	assert.Equal(t, "last_frame", actualContent[1].(map[string]any)["role"])
	assert.Equal(t, "text", actualContent[2].(map[string]any)["type"])
}
