package plugins_test

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadOpenRouterWanPlugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := plugins.Source("openrouter-wan")
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().RegisterFactory(source, jsplugin.Options{Key: "openrouter-wan"})
	require.NoError(t, err)
	return plugin
}

func roundTripOpenRouterWan(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(encoded, &decoded))
	return decoded
}

func TestOpenRouterWanVideoProtocolAndModels(t *testing.T) {
	plugin := loadOpenRouterWanPlugin(t)
	assert.Equal(t, "openrouter-wan", plugin.Meta.Key)
	assert.Equal(t, "https://openrouter.ai/api", plugin.Meta.BaseURL)
	assert.Equal(t, []string{"alibaba/wan-3.0", "alibaba/wan-3.0-prime"}, plugin.Meta.Models)
	assert.Len(t, plugin.Meta.Protocols, 1)
	assert.Equal(t, "openai_video", plugin.Meta.Protocols[0].Name)

	// The plugin only claims the host-owned video protocol, so these models
	// must not become candidates for ordinary chat endpoints.
	videoRegistry := jsplugin.NewRegistry()
	_, err := videoRegistry.RegisterFactory(mustSource(t, "openrouter-wan"), jsplugin.Options{Key: "openrouter-wan"})
	require.NoError(t, err)
	generation := videoRegistry.Generation()
	for _, model := range plugin.Meta.Models {
		_, found := generation.LookupEndpoint("POST", "/v1/chat/completions", model)
		assert.False(t, found, model)
		_, found = generation.LookupEndpoint("POST", "/v1/responses", model)
		assert.False(t, found, model)
		binding, found := generation.LookupEndpoint("POST", "/v1/videos", model)
		require.True(t, found, model)
		assert.Equal(t, "openai_video", binding.Protocol)
	}
}

func mustSource(t *testing.T, key string) string {
	t.Helper()
	source, err := plugins.Source(key)
	require.NoError(t, err)
	return source
}

func TestOpenRouterWanDecodesTextFirstFrameAndReferenceRequests(t *testing.T) {
	plugin := loadOpenRouterWanPlugin(t)
	decode := func(body map[string]any) (map[string]any, error) {
		value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "alibaba/wan-3.0",
			"body":  map[string]any{"kind": "json", "value": body},
		})
		if err != nil {
			return nil, err
		}
		return roundTripOpenRouterWan(t, value), nil
	}

	text, err := decode(map[string]any{
		"model":   "alibaba/wan-3.0",
		"prompt":  "a cat crossing a rainy street",
		"seconds": 5,
		"metadata": map[string]any{
			"resolution":     "720p",
			"ratio":          "16:9",
			"generate_audio": true,
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "text_to_video", text["action"])
	assert.Equal(t, "alibaba/wan-3.0", text["model"])
	assert.Equal(t, map[string]any{
		"prompt":         "a cat crossing a rainy street",
		"duration":       float64(5),
		"resolution":     "720p",
		"aspect_ratio":   "16:9",
		"generate_audio": true,
	}, text["requestBody"])

	firstFrame, err := decode(map[string]any{
		"model":   "alibaba/wan-3.0",
		"prompt":  "the cat looks at the camera",
		"seconds": 2,
		"metadata": map[string]any{
			"resolution": "480p",
			"ratio":      "9:16",
			"content": []any{map[string]any{
				"type": "image_url", "role": "first_frame",
				"image_url": map[string]any{"url": "data:image/png;base64,AAAA"},
			}},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "image_to_video", firstFrame["action"])
	assert.Equal(t, "alibaba/wan-3.0", firstFrame["model"])
	assert.Equal(t, map[string]any{
		"prompt":         "the cat looks at the camera",
		"duration":       float64(2),
		"resolution":     "480p",
		"aspect_ratio":   "9:16",
		"generate_audio": false,
		"frame_image":    "data:image/png;base64,AAAA",
	}, firstFrame["requestBody"])

	reference, err := decode(map[string]any{
		"model":   "alibaba/wan-3.0",
		"prompt":  "use the cat as the subject",
		"seconds": 5,
		"metadata": map[string]any{
			"resolution": "720p",
			"ratio":      "16:9",
			"content": []any{map[string]any{
				"type": "image_url", "role": "reference_image",
				"image_url": map[string]any{"url": "data:image/webp;base64,AAAA"},
			}},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "reference_to_video", reference["action"])
	assert.Equal(t, map[string]any{
		"prompt":          "use the cat as the subject",
		"duration":        float64(5),
		"resolution":      "720p",
		"aspect_ratio":    "16:9",
		"generate_audio":  false,
		"reference_image": "data:image/webp;base64,AAAA",
	}, reference["requestBody"])

	prime, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
		"model": "alibaba/wan-3.0-prime",
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model": "alibaba/wan-3.0-prime", "prompt": "a fast cinematic pan", "seconds": 30,
		}},
	})
	require.NoError(t, err)
	assert.Equal(t, "alibaba/wan-3.0-prime", roundTripOpenRouterWan(t, prime)["model"])

	alias, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
		"model":         "wan-video",
		"upstreamModel": "alibaba/wan-3.0",
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model": "wan-video", "prompt": "a mapped request", "seconds": 5,
		}},
	})
	require.NoError(t, err)
	aliasRequest := roundTripOpenRouterWan(t, alias)
	assert.Equal(t, "wan-video", aliasRequest["model"])
}

func TestOpenRouterWanBuildsPollAndArtifactRequests(t *testing.T) {
	plugin := loadOpenRouterWanPlugin(t)
	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"requestBody": map[string]any{
			"prompt":         "a cat",
			"duration":       float64(5),
			"resolution":     "720p",
			"aspect_ratio":   "16:9",
			"generate_audio": false,
		},
		"model":         "alibaba/wan-3.0",
		"upstreamModel": "alibaba/wan-3.0",
		"baseUrl":       "https://openrouter.ai/api",
		"apiKey":        "test-key",
	})
	require.NoError(t, err)
	descriptor := roundTripOpenRouterWan(t, value)
	assert.Equal(t, "POST", descriptor["method"])
	assert.Equal(t, "https://openrouter.ai/api/v1/videos", descriptor["url"])
	assert.Equal(t, map[string]any{"Authorization": "Bearer test-key", "Content-Type": "application/json"}, descriptor["headers"])
	body := descriptor["body"].(map[string]any)
	assert.Equal(t, "alibaba/wan-3.0", body["model"])
	assert.Equal(t, "a cat", body["prompt"])

	firstFrameSubmit, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"requestBody": map[string]any{
			"prompt": "a cat", "duration": float64(5), "resolution": "720p", "aspect_ratio": "16:9",
			"generate_audio": false, "frame_image": "data:image/png;base64,AAAA",
		},
		"model": "wan-video", "upstreamModel": "alibaba/wan-3.0", "baseUrl": "https://openrouter.ai/api", "apiKey": "test-key",
	})
	require.NoError(t, err)
	firstFrameBody := roundTripOpenRouterWan(t, firstFrameSubmit)["body"].(map[string]any)
	assert.Equal(t, "alibaba/wan-3.0", firstFrameBody["model"])
	assert.Equal(t, []any{map[string]any{
		"type": "image_url", "image_url": map[string]any{"url": "data:image/png;base64,AAAA"}, "frame_type": "first_frame",
	}}, firstFrameBody["frame_images"])

	referenceSubmit, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"requestBody": map[string]any{
			"prompt": "a cat", "duration": float64(5), "resolution": "720p", "aspect_ratio": "16:9",
			"generate_audio": false, "reference_image": "data:image/webp;base64,AAAA",
		},
		"model": "alibaba/wan-3.0", "upstreamModel": "alibaba/wan-3.0", "baseUrl": "https://openrouter.ai/api", "apiKey": "test-key",
	})
	require.NoError(t, err)
	referenceBody := roundTripOpenRouterWan(t, referenceSubmit)["body"].(map[string]any)
	assert.Equal(t, []any{map[string]any{
		"type": "image_url", "image_url": map[string]any{"url": "data:image/webp;base64,AAAA"},
	}}, referenceBody["input_references"])

	query, err := plugin.Engine.Call(t.Context(), "buildQueryRequest", map[string]any{
		"taskId":  "video_123",
		"baseUrl": "https://openrouter.ai/api",
		"apiKey":  "test-key",
	})
	require.NoError(t, err)
	queryDescriptor := roundTripOpenRouterWan(t, query)
	assert.Equal(t, "https://openrouter.ai/api/v1/videos/video_123", queryDescriptor["url"])

	content, err := plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{
		"artifactKey":    "video",
		"upstreamTaskId": "video_123",
		"baseUrl":        "https://openrouter.ai/api",
		"apiKey":         "test-key",
		"clientRequest":  map[string]any{"method": "GET"},
	})
	require.NoError(t, err)
	contentDescriptor := roundTripOpenRouterWan(t, content)
	assert.Equal(t, "https://openrouter.ai/api/v1/videos/video_123/content", contentDescriptor["url"])
	assert.Equal(t, "GET", contentDescriptor["method"])

	parse, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "video_123"}, map[string]any{
		"id": "video_123", "status": "completed", "progress": 100,
	})
	require.NoError(t, err)
	assert.Equal(t, "SUCCESS", roundTripOpenRouterWan(t, parse)["status"])

	artifacts, err := plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"status": "SUCCESS"})
	require.NoError(t, err)
	assert.Equal(t, []any{map[string]any{"key": "video", "type": "video", "mimeType": "video/mp4"}}, artifacts)

	expired, err := plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "video_123"}, map[string]any{
		"id": "video_123", "status": "expired", "error": "job exceeded maximum time to live",
	})
	require.NoError(t, err)
	assert.Equal(t, "FAILURE", roundTripOpenRouterWan(t, expired)["status"])
}

func TestOpenRouterWanRejectsUnsupportedVideoInputs(t *testing.T) {
	plugin := loadOpenRouterWanPlugin(t)
	for _, testCase := range []struct {
		name string
		body map[string]any
		err  string
	}{
		{"empty prompt", map[string]any{"prompt": " "}, "prompt is required"},
		{"duration below minimum", map[string]any{"prompt": "p", "seconds": 1}, "duration must be an integer between 2 and 30"},
		{"duration above maximum", map[string]any{"prompt": "p", "seconds": 31}, "duration must be an integer between 2 and 30"},
		{"unsupported resolution", map[string]any{"prompt": "p", "metadata": map[string]any{"resolution": "4k"}}, "resolution must be one of 480p, 720p, 1080p"},
		{"unsupported ratio", map[string]any{"prompt": "p", "metadata": map[string]any{"ratio": "21:9"}}, "ratio must be one of 16:9, 4:3, 1:1, 3:4, 9:16"},
		{"last frame", map[string]any{"prompt": "p", "metadata": map[string]any{"content": []any{map[string]any{"type": "image_url", "role": "last_frame", "image_url": map[string]any{"url": "data:image/png;base64,AAAA"}}}}}, "only one first_frame image is supported"},
		{"reference video", map[string]any{"prompt": "p", "metadata": map[string]any{"content": []any{map[string]any{"type": "video_url", "role": "reference_video", "video_url": map[string]any{"url": "https://example.com/v.mp4"}}}}}, "only one first_frame image is supported"},
		{"oversized first frame", map[string]any{"prompt": "p", "metadata": map[string]any{"content": []any{map[string]any{"type": "image_url", "role": "first_frame", "image_url": map[string]any{"url": "data:image/png;base64," + strings.Repeat("A", 40*1024*1024+4)}}}}}, "first_frame must not exceed 30 MB"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
				"model": "alibaba/wan-3.0",
				"body":  map[string]any{"kind": "json", "value": testCase.body},
			})
			require.ErrorContains(t, err, testCase.err)
		})
	}

	_, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
		"model": "alibaba/wan-3.0-prime",
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"prompt": "p",
			"metadata": map[string]any{"content": []any{map[string]any{
				"type": "image_url", "role": "reference_image",
				"image_url": map[string]any{"url": "data:image/png;base64,AAAA"},
			}}},
		}},
	})
	require.ErrorContains(t, err, "reference images are not supported by alibaba/wan-3.0-prime")
}
