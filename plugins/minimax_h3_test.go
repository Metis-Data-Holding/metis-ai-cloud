package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	taskjsplugin "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
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

func TestMinimaxH3OpenAIVideoDecodeMultipartFirstFrame(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)
	decode := func(body map[string]any) (map[string]any, error) {
		value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "minimax-h3-fl2va",
			"body":  body,
		})
		if err != nil {
			return nil, err
		}
		return minimaxH3Map(t, value), nil
	}

	intent, err := decode(map[string]any{
		"kind": "multipart",
		"fields": map[string][]string{
			"prompt":   {"cat by the window"},
			"seconds":  {"5"},
			"metadata": {`{"resolution":"768p","ratio":"16:9","generate_audio":false}`},
		},
		"files": []map[string]any{{
			"ref": "request_file:input_reference", "field": "input_reference", "filename": "cat.png", "mimeType": "image/png", "size": 3,
		}},
	})
	require.NoError(t, err)
	assert.Equal(t, "image_to_video", intent["action"])
	request := intent["requestBody"].(map[string]any)
	assert.Equal(t, "cat by the window", request["prompt"])
	assert.Equal(t, "request_file:input_reference", request["input_reference"].(map[string]any)["__fileRef"])
	assert.Equal(t, "768p", request["resolution"])
	assert.Equal(t, "16:9", request["ratio"])
	assert.Equal(t, false, request["generate_audio"])

	tests := []struct {
		name  string
		files []map[string]any
		body  map[string][]string
		err   string
	}{
		{
			name: "multiple input references",
			files: []map[string]any{
				{"ref": "request_file:input_reference", "field": "input_reference", "filename": "one.png", "mimeType": "image/png"},
				{"ref": "request_file:input_reference", "field": "input_reference", "filename": "two.png", "mimeType": "image/png"},
			},
			body: map[string][]string{"prompt": {"p"}},
			err:  "input_reference must be provided once",
		},
		{
			name:  "unexpected file field",
			files: []map[string]any{{"ref": "request_file:reference", "field": "reference", "filename": "one.png", "mimeType": "image/png"}},
			body:  map[string][]string{"prompt": {"p"}},
			err:   "unexpected file field: reference",
		},
		{
			name:  "invalid metadata",
			files: []map[string]any{{"ref": "request_file:input_reference", "field": "input_reference", "filename": "one.png", "mimeType": "image/png"}},
			body:  map[string][]string{"prompt": {"p"}, "metadata": {"not-json"}},
			err:   "metadata must be a JSON object string",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, callErr := decode(map[string]any{"kind": "multipart", "fields": test.body, "files": test.files})
			require.ErrorContains(t, callErr, test.err)
		})
	}
}

func TestMinimaxH3OpenAIVideoDecodeMultipartKeyframes(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)
	decode := func(body map[string]any) (map[string]any, error) {
		value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "minimax-h3-fl2va",
			"body":  body,
		})
		if err != nil {
			return nil, err
		}
		return minimaxH3Map(t, value), nil
	}

	intent, err := decode(map[string]any{
		"kind": "multipart",
		"fields": map[string][]string{
			"prompt": {"cat by the window"},
		},
		"files": []map[string]any{
			{"ref": "request_file:input_reference", "field": "input_reference", "filename": "first.png", "mimeType": "image/png", "size": 3},
			{"ref": "request_file:input_last_frame", "field": "input_last_frame", "filename": "last.webp", "mimeType": "image/webp", "size": 4},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "image_to_video", intent["action"])
	request := intent["requestBody"].(map[string]any)
	assert.Equal(t, "request_file:input_reference", request["input_reference"].(map[string]any)["__fileRef"])
	assert.Equal(t, "request_file:input_last_frame", request["input_last_frame"].(map[string]any)["__fileRef"])

	_, err = decode(map[string]any{
		"kind":   "multipart",
		"fields": map[string][]string{"prompt": {"p"}},
		"files":  []map[string]any{{"ref": "request_file:input_last_frame", "field": "input_last_frame", "filename": "last.png", "mimeType": "image/png", "size": 3}},
	})
	require.ErrorContains(t, err, "input_last_frame requires input_reference")
}

func TestMinimaxH3OpenAIVideoDecodeMultipartReferenceContent(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)
	value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
		"model": "minimax-h3-fl2va",
		"body": map[string]any{
			"kind":   "multipart",
			"fields": map[string][]string{"prompt": {"use the references"}},
			"files": []map[string]any{
				{"ref": "request_file:reference_image_0", "field": "reference_image_0", "filename": "one.png", "mimeType": "image/png"},
				{"ref": "request_file:reference_image_1", "field": "reference_image_1", "filename": "two.jpg", "mimeType": "image/jpeg"},
				{"ref": "request_file:reference_video_0", "field": "reference_video_0", "filename": "motion.mp4", "mimeType": "video/mp4"},
			},
		},
	})
	require.NoError(t, err)
	decoded := minimaxH3Map(t, value)
	assert.Equal(t, "reference_to_video", decoded["action"])
	request := decoded["requestBody"].(map[string]any)
	assert.Equal(t, "request_file:reference_image_0", request["reference_image_0"].(map[string]any)["__fileRef"])
	assert.Equal(t, "request_file:reference_image_1", request["reference_image_1"].(map[string]any)["__fileRef"])
	assert.Equal(t, "request_file:reference_video_0", request["reference_video_0"].(map[string]any)["__fileRef"])
}

func TestMinimaxH3ReferenceContentSurvivesHostSerialization(t *testing.T) {
	plugin := loadMinimaxH3Plugin(t)
	value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
		"model": "minimax-h3-fl2va",
		"body": map[string]any{
			"kind":   "multipart",
			"fields": map[string][]string{"prompt": {"animate the subject"}},
			"files": []map[string]any{{
				"ref": "request_file:reference_image_0", "field": "reference_image_0", "filename": "subject.png", "mimeType": "image/png", "size": 5,
			}},
		},
	})
	require.NoError(t, err)
	request := minimaxH3Map(t, value)["requestBody"].(map[string]any)
	context := minimaxH3SubmitContext(request, "task/reference-image")
	context["files"] = []map[string]any{{
		"ref": "request_file:reference_image_0", "field": "reference_image_0", "filename": "subject.png", "mimeType": "image/png", "size": 5,
	}}

	descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", context)
	workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
	assert.Equal(t, "MiniMaxH3ReferenceToVideo", workflow["4"].(map[string]any)["class_type"])
}

func TestMinimaxH3OpenAIVideoRender(t *testing.T) {
	adaptor := taskjsplugin.New(loadMinimaxH3Plugin(t))
	rendered, err := adaptor.ConvertToOpenAIVideo(&model.Task{
		TaskID:    "task_public",
		Status:    model.TaskStatusInProgress,
		Progress:  "37%",
		CreatedAt: 10,
		Properties: model.Properties{
			OriginModelName: "minimax-h3-fl2va",
		},
	})
	require.NoError(t, err)

	var video dto.OpenAIVideo
	require.NoError(t, common.Unmarshal(rendered, &video))
	assert.Equal(t, "task_public", video.ID)
	assert.Equal(t, "minimax-h3-fl2va", video.Model)
	assert.Equal(t, dto.VideoStatusInProgress, video.Status)
	assert.Equal(t, 37, video.Progress)
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
			assert.NotContains(t, descriptor, "prepareRequest")
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

	t.Run("reference images and video use the Ref2VA workflow", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "use the pictures and video", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false,
			"reference_image_0": map[string]any{"__fileRef": "request_file:reference_image_0"},
			"reference_image_1": map[string]any{"__fileRef": "request_file:reference_image_1"},
			"reference_video_0": map[string]any{"__fileRef": "request_file:reference_video_0"},
		}
		context := minimaxH3SubmitContext(requestBody, "task/reference")
		context["files"] = []map[string]any{
			{"ref": "request_file:reference_image_0", "field": "reference_image_0", "filename": "one.png", "mimeType": "image/png", "size": 3},
			{"ref": "request_file:reference_image_1", "field": "reference_image_1", "filename": "two.jpg", "mimeType": "image/jpeg", "size": 4},
			{"ref": "request_file:reference_video_0", "field": "reference_video_0", "filename": "motion.mp4", "mimeType": "video/mp4", "size": 5},
		}
		descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", context)
		prepare := descriptor["prepareRequests"].([]any)
		require.Len(t, prepare, 3)
		assert.Equal(t, "temp", prepare[0].(map[string]any)["parts"].([]any)[1].(map[string]any)["value"])
		assert.Equal(t, "temp", prepare[1].(map[string]any)["parts"].([]any)[1].(map[string]any)["value"])
		assert.Equal(t, "input", prepare[2].(map[string]any)["parts"].([]any)[1].(map[string]any)["value"])

		workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
		assert.Equal(t, "minimax_h3_ref2va_pruned_int8_convrot.safetensors", workflow["1"].(map[string]any)["inputs"].(map[string]any)["unet_name"])
		ref2va := workflow["4"].(map[string]any)
		assert.Equal(t, "MiniMaxH3ReferenceToVideo", ref2va["class_type"])
		inputs := ref2va["inputs"].(map[string]any)
		assert.Equal(t, []any{"14", float64(0)}, inputs["ref_images.ref_image_0"])
		assert.Equal(t, []any{"15", float64(0)}, inputs["ref_images.ref_image_1"])
		assert.Equal(t, []any{"16", float64(0)}, inputs["ref_videos.ref_video_0"])
		assert.Equal(t, []any{"9", float64(0)}, workflow["10"].(map[string]any)["inputs"].(map[string]any)["samples"])
		video := workflow["16"].(map[string]any)["inputs"].(map[string]any)
		assert.Equal(t, "minimax-h3-task-reference-reference-video.mp4", video["video"])
		assert.EqualValues(t, 24, video["force_rate"])
		assert.EqualValues(t, 360, video["frame_load_cap"])
		assert.Equal(t, "AnimateDiff", video["format"])
	})

	t.Run("reference video works without reference images", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "follow the reference motion", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false,
			"reference_video_0": map[string]any{"__fileRef": "request_file:reference_video_0"},
		}
		context := minimaxH3SubmitContext(requestBody, "task/video-only")
		context["files"] = []map[string]any{{
			"ref": "request_file:reference_video_0", "field": "reference_video_0", "filename": "motion.mp4", "mimeType": "video/mp4", "size": 5,
		}}

		descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", context)
		workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
		assert.NotContains(t, workflow, "14")
		assert.Equal(t, []any{"16", float64(0)}, workflow["4"].(map[string]any)["inputs"].(map[string]any)["ref_videos.ref_video_0"])
	})

	t.Run("reference image supports generated audio", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "animate the subject", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": true,
			"reference_image_0": map[string]any{"__fileRef": "request_file:reference_image_0"},
		}
		context := minimaxH3SubmitContext(requestBody, "task/image-audio")
		context["files"] = []map[string]any{{
			"ref": "request_file:reference_image_0", "field": "reference_image_0", "filename": "subject.png", "mimeType": "image/png", "size": 5,
		}}

		descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", context)
		workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
		assert.Equal(t, []any{"14", float64(0)}, workflow["4"].(map[string]any)["inputs"].(map[string]any)["ref_images.ref_image_0"])
		assert.Equal(t, []any{"9", float64(0)}, workflow["17"].(map[string]any)["inputs"].(map[string]any)["samples"])
		assert.Equal(t, []any{"17", float64(0)}, workflow["11"].(map[string]any)["inputs"].(map[string]any)["audio"])
	})

	t.Run("reference video respects the gateway multipart limit", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "follow the reference motion", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false,
			"reference_video_0": map[string]any{"__fileRef": "request_file:reference_video_0"},
		}
		context := minimaxH3SubmitContext(requestBody, "task/large-video")
		context["files"] = []map[string]any{{
			"ref": "request_file:reference_video_0", "field": "reference_video_0", "filename": "motion.mp4", "mimeType": "video/mp4", "size": 64*1024*1024 + 1,
		}}

		_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", context)
		require.ErrorContains(t, err, "reference video must not exceed 64 MiB")
	})

	t.Run("first frame uses a prepared Comfy upload", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "cat by the window", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false,
			"input_reference": map[string]any{"__fileRef": "request_file:input_reference"},
		}
		context := minimaxH3SubmitContext(requestBody, "task/first-frame")
		context["files"] = []map[string]any{{"ref": "request_file:input_reference", "field": "input_reference", "filename": "cat.png", "mimeType": "image/png", "size": 3}}
		descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", context)
		prepare := descriptor["prepareRequest"].(map[string]any)
		assert.Equal(t, "http://100.64.0.10:8888/upload/image", prepare["url"])
		assert.Equal(t, "POST", prepare["method"])
		assert.Equal(t, "multipart", prepare["bodyType"])
		parts := prepare["parts"].([]any)
		require.Len(t, parts, 3)
		imagePart := parts[0].(map[string]any)
		typePart := parts[1].(map[string]any)
		overwritePart := parts[2].(map[string]any)
		assert.Equal(t, "image", imagePart["name"])
		assert.Equal(t, "request_file:input_reference", imagePart["fileRef"])
		assert.Equal(t, "minimax-h3-task-first-frame.png", imagePart["filename"])
		assert.Equal(t, "type", typePart["name"])
		assert.Equal(t, "temp", typePart["value"])
		assert.Equal(t, "overwrite", overwritePart["name"])
		assert.Equal(t, true, overwritePart["value"])

		workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
		loadImage := workflow["15"].(map[string]any)
		assert.Equal(t, "LoadImage", loadImage["class_type"])
		loadImageInputs := loadImage["inputs"].(map[string]any)
		assert.Equal(t, "minimax-h3-task-first-frame.png [temp]", loadImageInputs["image"])
		videoInputs := workflow["4"].(map[string]any)["inputs"].(map[string]any)
		assert.Equal(t, []any{"15", float64(0)}, videoInputs["first_frame"])
	})

	t.Run("first and last frames use ordered prepared Comfy uploads", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "cat by the window", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false,
			"input_reference":  map[string]any{"__fileRef": "request_file:input_reference"},
			"input_last_frame": map[string]any{"__fileRef": "request_file:input_last_frame"},
		}
		context := minimaxH3SubmitContext(requestBody, "task/keyframes")
		context["files"] = []map[string]any{
			{"ref": "request_file:input_reference", "field": "input_reference", "filename": "first.png", "mimeType": "image/png", "size": 3},
			{"ref": "request_file:input_last_frame", "field": "input_last_frame", "filename": "last.png", "mimeType": "image/png", "size": 3},
		}
		descriptor := callMinimaxH3Hook(t, plugin, "buildSubmitRequest", context)
		prepare := descriptor["prepareRequests"].([]any)
		require.Len(t, prepare, 2)
		firstPrepare := prepare[0].(map[string]any)
		lastPrepare := prepare[1].(map[string]any)
		assert.Equal(t, "http://100.64.0.10:8888/upload/image", firstPrepare["url"])
		assert.Equal(t, "http://100.64.0.10:8888/upload/image", lastPrepare["url"])
		assert.NotEqual(t, firstPrepare["parts"].([]any)[0].(map[string]any)["filename"], lastPrepare["parts"].([]any)[0].(map[string]any)["filename"])
		assert.Equal(t, "request_file:input_reference", firstPrepare["parts"].([]any)[0].(map[string]any)["fileRef"])
		assert.Equal(t, "request_file:input_last_frame", lastPrepare["parts"].([]any)[0].(map[string]any)["fileRef"])

		workflow := descriptor["body"].(map[string]any)["prompt"].(map[string]any)
		firstLoadImage := workflow["15"].(map[string]any)
		lastLoadImage := workflow["16"].(map[string]any)
		assert.Equal(t, "LoadImage", firstLoadImage["class_type"])
		assert.Equal(t, "LoadImage", lastLoadImage["class_type"])
		assert.Equal(t, []any{"15", float64(0)}, workflow["4"].(map[string]any)["inputs"].(map[string]any)["first_frame"])
		assert.Equal(t, []any{"16", float64(0)}, workflow["4"].(map[string]any)["inputs"].(map[string]any)["last_frame"])
	})

	t.Run("first frame enforces the server-side size limit", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "cat by the window", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false,
			"input_reference": map[string]any{"__fileRef": "request_file:input_reference"},
		}
		for _, size := range []int{0, 30 * 1024 * 1024} {
			context := minimaxH3SubmitContext(requestBody, "task-oversized")
			context["files"] = []map[string]any{{"ref": "request_file:input_reference", "field": "input_reference", "filename": "cat.png", "mimeType": "image/png", "size": size}}
			_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", context)
			require.ErrorContains(t, err, "input_reference must be smaller than 30 MiB")
		}
	})

	t.Run("first and last frames enforce the combined size limit", func(t *testing.T) {
		requestBody := map[string]any{
			"prompt": "cat by the window", "duration": 5, "resolution": "768p", "ratio": "16:9", "generate_audio": false,
			"input_reference":  map[string]any{"__fileRef": "request_file:input_reference"},
			"input_last_frame": map[string]any{"__fileRef": "request_file:input_last_frame"},
		}
		validContext := minimaxH3SubmitContext(requestBody, "task-combined-limit")
		validContext["files"] = []map[string]any{
			{"ref": "request_file:input_reference", "field": "input_reference", "filename": "first.png", "mimeType": "image/png", "size": 29 * 1024 * 1024},
			{"ref": "request_file:input_last_frame", "field": "input_last_frame", "filename": "last.png", "mimeType": "image/png", "size": 16 * 1024 * 1024},
		}
		_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", validContext)
		require.NoError(t, err)

		overLimitContext := minimaxH3SubmitContext(requestBody, "task-combined-limit")
		overLimitContext["files"] = []map[string]any{
			{"ref": "request_file:input_reference", "field": "input_reference", "filename": "first.png", "mimeType": "image/png", "size": 29 * 1024 * 1024},
			{"ref": "request_file:input_last_frame", "field": "input_last_frame", "filename": "last.png", "mimeType": "image/png", "size": 16*1024*1024 + 1},
		}
		_, err = plugin.Engine.Call(t.Context(), "buildSubmitRequest", overLimitContext)
		require.ErrorContains(t, err, "input frames must not exceed 45 MiB in total")
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
