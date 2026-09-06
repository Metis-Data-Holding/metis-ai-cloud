export const meta = {
  apiVersion: 1,
  key: "minimax-h3",
  name: "MiniMax H3",
  icon: "Minimax.Color",
  description: {
    en: "Self-hosted MiniMax H3 text and first-frame image to video through ComfyUI",
    zh: "通过 ComfyUI 接入自托管 MiniMax H3 文生及首帧图生视频",
  },
  version: "1.1.0",
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

const imageExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const maxFirstFrameBytes = 30 * 1024 * 1024;

function inputReferenceMarker(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 1 || value.__fileRef !== "request_file:input_reference") return null;
  return value;
}

function normalizedRequest(request) {
  const req = request || {};
  const metadata = req.metadata && typeof req.metadata === "object" && !Array.isArray(req.metadata) ? req.metadata : {};
  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("prompt is required");
  if (Object.prototype.hasOwnProperty.call(metadata, "content")) throw new Error("reference content is not supported");
  if (req.images !== undefined) throw new Error("reference content is not supported");
  let inputReference;
  if (req.input_reference !== undefined) {
    inputReference = inputReferenceMarker(req.input_reference);
    if (!inputReference) throw new Error("reference content is not supported");
  }

  const rawDuration = req.duration === undefined ? req.seconds : req.duration;
  const duration = rawDuration === undefined ? 5 : Number(rawDuration);
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) throw new Error("duration must be an integer between 5 and 15");

  const resolution = String(req.resolution || metadata.resolution || "768p").toLowerCase();
  if (resolution !== "768p") throw new Error("resolution must be 768p");
  const ratio = String(req.ratio || metadata.ratio || "16:9");
  if (!sizes[ratio]) throw new Error("ratio must be one of 16:9, 9:16, 1:1, 4:3, 3:4");
  const generateAudio = req.generate_audio === undefined ? metadata.generate_audio === true : req.generate_audio === true;
  return { prompt, duration, resolution, ratio, generate_audio: generateAudio, input_reference: inputReference };
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
  return hash >>> 0 || 1;
}

function workflowFor(request, publicTaskId, firstFrame) {
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
  if (firstFrame) {
    workflow[15] = { class_type: "LoadImage", inputs: { image: firstFrame.filename + " [temp]" } };
    workflow[4].inputs.first_frame = ["15", 0];
  }
  if (request.generate_audio) {
    workflow[13] = { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } };
    workflow[14] = { class_type: "VAEDecodeAudio", inputs: { samples: ["9", 1], vae: ["13", 0] } };
    workflow[11].inputs.audio = ["14", 0];
  }
  return workflow;
}

export function buildSubmitRequest(ctx) {
  const request = normalizedRequest(ctx.requestBody);
  const files = (ctx.files || []).filter(function (file) {
    return file && file.field === "input_reference";
  });
  let firstFrame = null;
  if (request.input_reference) {
    if (files.length !== 1 || files[0].ref !== request.input_reference.__fileRef) throw new Error("input_reference file is missing");
    const mimeType = String(files[0].mimeType || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(imageExtensions, mimeType)) throw new Error("input_reference must be image/jpeg, image/png, or image/webp");
    const fileSize = Number(files[0].size);
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize >= maxFirstFrameBytes) throw new Error("input_reference must be smaller than 30 MiB");
    const extension = imageExtensions[mimeType];
    const taskID =
      trimmed(ctx.publicTaskId)
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "task";
    firstFrame = { ref: files[0].ref, filename: "minimax-h3-" + taskID + "." + extension };
  } else if (files.length > 0) {
    throw new Error("unexpected input_reference file");
  }
  const descriptor = {
    url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/prompt",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: { prompt: workflowFor(request, ctx.publicTaskId, firstFrame) },
    action: firstFrame ? "image_to_video" : "text_to_video",
  };
  if (firstFrame) {
    descriptor.prepareRequest = {
      url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/upload/image",
      method: "POST",
      headers: { Accept: "application/json" },
      bodyType: "multipart",
      parts: [
        { name: "image", fileRef: firstFrame.ref, filename: firstFrame.filename },
        { name: "type", value: "temp" },
        { name: "overwrite", value: true },
      ],
    };
  }
  return descriptor;
}

export function parseSubmitResponse(_ctx, response) {
  const body = (response && response.body) || {};
  if (body.node_errors && typeof body.node_errors === "object" && Object.keys(body.node_errors).length > 0) {
    throw new Error("ComfyUI rejected the workflow");
  }
  const taskId = trimmed(body.prompt_id);
  if (!taskId) throw new Error("ComfyUI did not return prompt_id");
  return { taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/history/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json" },
  };
}

function validVideoOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const filename = trimmed(value.filename);
  const subfolder = String(value.subfolder || "");
  const type = String(value.type || "output");
  if (!filename || !/\.mp4$/i.test(filename) || /[\\/\0]/.test(filename)) return null;
  if (/\\|\0/.test(subfolder) || subfolder.split("/").includes("..")) return null;
  if (!["input", "output", "temp"].includes(type)) return null;
  return { filename, subfolder, type };
}

function historyEntry(data, taskId, allowOnlyEntry) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data[taskId] && typeof data[taskId] === "object") return data[taskId];
  const keys = Object.keys(data);
  return allowOnlyEntry && keys.length === 1 && data[keys[0]] && typeof data[keys[0]] === "object" ? data[keys[0]] : null;
}

function videoOutput(data, taskId, allowOnlyEntry) {
  const entry = historyEntry(data, taskId, allowOnlyEntry);
  const outputs = entry && entry.outputs;
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return null;
  for (const node of Object.values(outputs)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    for (const key of ["animated", "videos", "images"]) {
      const items = node[key];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const output = validVideoOutput(item);
        if (output) return output;
      }
    }
  }
  return null;
}

export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: "UNKNOWN", reason: "unrecognized ComfyUI history" };
  if (Object.keys(body).length === 0) return { status: "IN_PROGRESS" };
  const entry = historyEntry(body, ctx.taskId, false);
  if (!entry) return { status: "UNKNOWN", reason: "unrecognized ComfyUI history" };
  const status = entry.status && typeof entry.status === "object" ? entry.status : {};
  const value = String(status.status_str || "").toLowerCase();
  if (["error", "failed", "interrupted"].includes(value)) return { status: "FAILURE", reason: "ComfyUI task failed" };
  if (status.completed === true || value === "success") {
    if (!videoOutput(body, ctx.taskId, false)) return { status: "FAILURE", progress: "100%", reason: "video output is missing" };
    return { status: "SUCCESS", progress: "100%" };
  }
  if (["running", "pending", "queued"].includes(value) || status.completed === false) return { status: "IN_PROGRESS" };
  return { status: "UNKNOWN", reason: "unrecognized ComfyUI history" };
}

export function extractUsage(ctx) {
  const request = normalizedRequest(ctx.requestBody);
  return { seconds: request.duration, resolution: request.resolution, generate_audio: request.generate_audio };
}

export function listArtifacts(task) {
  if (String(task.status || "").toUpperCase() !== "SUCCESS" || !videoOutput(task.data, "", true)) return [];
  return [{ key: "video", type: "video", mimeType: "video/mp4" }];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const output = videoOutput(ctx.data, ctx.upstreamTaskId, true);
  if (!output) throw new Error("artifact_not_found");
  const query =
    "filename=" + encodeURIComponent(output.filename) + "&subfolder=" + encodeURIComponent(output.subfolder) + "&type=" + encodeURIComponent(output.type);
  return {
    url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/view?" + query,
    method: ctx.clientRequest && ctx.clientRequest.method === "HEAD" ? "HEAD" : "GET",
    credentialless: true,
  };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
      let req;
      let hasInputReferenceFile = false;
      if (ctx.body.kind === "json") {
        if (!ctx.body.value || typeof ctx.body.value !== "object" || Array.isArray(ctx.body.value)) throw new Error("JSON object required");
        req = Object.assign({}, ctx.body.value);
      } else {
        const first = function (name) {
          const values = (ctx.body.fields || {})[name] || [];
          if (values.length > 1) throw new Error(name + " must be provided once");
          return values[0];
        };
        req = {};
        const fields = ctx.body.fields || {};
        for (const name of Object.keys(fields)) req[name] = first(name);
        for (const file of ctx.body.files || []) {
          if (file.field !== "input_reference") throw new Error("unexpected file field: " + file.field);
          if (hasInputReferenceFile) throw new Error("input_reference must be provided once");
          hasInputReferenceFile = true;
        }
        if (hasInputReferenceFile && Object.prototype.hasOwnProperty.call(req, "input_reference"))
          throw new Error("input_reference must be provided as a file");
        if (req.metadata !== undefined) {
          let parsed;
          try {
            parsed = JSON.parse(req.metadata);
          } catch (e) {
            throw new Error("metadata must be a JSON object string");
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("metadata must be a JSON object string");
          req.metadata = parsed;
        }
        if (req.seconds !== undefined) req.seconds = Number(req.seconds);
        else if (req.duration !== undefined) req.duration = Number(req.duration);
        if (hasInputReferenceFile) req.input_reference = { __fileRef: "request_file:input_reference" };
      }
      const request = normalizedRequest(req);
      return { kind: "submit", model: ctx.model, action: request.input_reference ? "image_to_video" : "text_to_video", requestBody: request };
    },
    render: function () {
      return {};
    },
  },
};
