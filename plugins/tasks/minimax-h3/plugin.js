export const meta = {
  apiVersion: 1,
  key: "minimax-h3",
  name: "MiniMax H3",
  icon: "Minimax.Color",
  description: {
    en: "Self-hosted MiniMax H3 text-to-video through ComfyUI",
    zh: "通过 ComfyUI 接入自托管 MiniMax H3 文生视频",
  },
  version: "1.0.0",
  author: { name: "Metis Data" },
  models: ["minimax-h3-fl2va"],
  fetchMode: "per_task",
  auth: "none",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Requested video duration in seconds.", zh: "请求的视频时长，单位为秒。" },
    },
    resolution: {
      enum: ["768p"],
      description: { en: "Requested video output resolution.", zh: "请求的视频输出分辨率。" },
    },
    generate_audio: {
      type: "boolean",
      description: { en: "Whether native synchronized audio is generated.", zh: "是否生成原生同步音频。" },
    },
  },
  protocols: ["openai_video"],
};

const sizes = {
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "1:1": [768, 768],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
};

function trimmed(value) {
  return String(value || "").trim();
}

function normalizedRequest(request) {
  const req = request || {};
  const metadata = req.metadata && typeof req.metadata === "object" && !Array.isArray(req.metadata) ? req.metadata : {};
  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("prompt is required");
  if (Object.prototype.hasOwnProperty.call(metadata, "content")) throw new Error("reference content is not supported");
  if (req.images !== undefined || req.input_reference !== undefined) throw new Error("reference content is not supported");

  const rawDuration = req.duration === undefined ? req.seconds : req.duration;
  const duration = rawDuration === undefined ? 5 : Number(rawDuration);
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) throw new Error("duration must be an integer between 5 and 15");

  const resolution = String(req.resolution || metadata.resolution || "768p").toLowerCase();
  if (resolution !== "768p") throw new Error("resolution must be 768p");
  const ratio = String(req.ratio || metadata.ratio || "16:9");
  if (!sizes[ratio]) throw new Error("ratio must be one of 16:9, 9:16, 1:1, 4:3, 3:4");
  const generateAudio = req.generate_audio === undefined ? metadata.generate_audio === true : req.generate_audio === true;
  return { prompt, duration, resolution, ratio, generate_audio: generateAudio };
}

function frameCount(seconds) {
  const frames = Math.max(5, Math.round(seconds * 24));
  return frames + ((5 - (frames % 17) + 17) % 17);
}

function taskSeed(taskId) {
  const value = trimmed(taskId) || "minimax-h3";
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function workflowFor(request, publicTaskId) {
  const size = sizes[request.ratio];
  const workflow = {
    1: { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors", weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
    4: {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { clip: ["2", 0], vae: ["3", 0], prompt: request.prompt, width: size[0], height: size[1], length: frameCount(request.duration) },
    },
    5: { class_type: "RandomNoise", inputs: { noise_seed: taskSeed(publicTaskId) } },
    6: { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    7: { class_type: "BasicScheduler", inputs: { model: ["1", 0], scheduler: "simple", steps: 20, denoise: 1 } },
    8: { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: ["4", 0] } },
    9: {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["5", 0], guider: ["8", 0], sampler: ["6", 0], sigmas: ["7", 0], latent_image: ["4", 1] },
    },
    10: { class_type: "VAEDecode", inputs: { samples: ["9", 1], vae: ["3", 0] } },
    11: { class_type: "CreateVideo", inputs: { images: ["10", 0], fps: 24, bit_depth: 8, color_space: "sRGB" } },
    12: { class_type: "SaveVideo", inputs: { video: ["11", 0], filename_prefix: "MiniMaxH3", format: "auto", codec: "auto" } },
  };
  if (request.generate_audio) {
    workflow[13] = { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } };
    workflow[14] = { class_type: "VAEDecodeAudio", inputs: { samples: ["9", 1], vae: ["13", 0] } };
    workflow[11].inputs.audio = ["14", 0];
  }
  return workflow;
}

export function buildSubmitRequest(ctx) {
  const request = normalizedRequest(ctx.requestBody);
  return {
    url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/prompt",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: { prompt: workflowFor(request, ctx.publicTaskId) },
    action: "text_to_video",
  };
}

export function parseSubmitResponse() {
  throw new Error("MiniMax H3 response handling is not implemented");
}

export function buildQueryRequest() {
  throw new Error("MiniMax H3 response handling is not implemented");
}

export function parseTaskResult() {
  throw new Error("MiniMax H3 response handling is not implemented");
}

export function listArtifacts() {
  return [];
}

export function buildContentRequest() {
  throw new Error("MiniMax H3 response handling is not implemented");
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      if (!ctx.body.value || typeof ctx.body.value !== "object" || Array.isArray(ctx.body.value)) throw new Error("JSON object required");
      const request = normalizedRequest(ctx.body.value);
      return { kind: "submit", model: ctx.model, action: "text_to_video", requestBody: request };
    },
    render: function (_ctx, task) {
      return task;
    },
  },
};
