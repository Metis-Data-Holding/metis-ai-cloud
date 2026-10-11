const outputNodeId = "461";

export const meta = {
  apiVersion: 1,
  key: "qwen-image-21",
  name: "Qwen-Image-2.1 (Internal Evaluation)",
  description: {
    en: "Internal research evaluation of self-hosted Qwen-Image-2.1 through ComfyUI",
    zh: "通过 ComfyUI 进行自托管 Qwen-Image-2.1 内部研究评估",
  },
  version: "1.0.0",
  author: { name: "Metis Data" },
  models: ["qwen-image-2.1"],
  fetchMode: "per_task",
  auth: "none",
  requiredCapabilities: ["image-artifacts@1"],
  usageSchema: {
    image_count: {
      type: "number",
      unit: "count",
      description: { en: "Image generation unit price", zh: "图片生成单价" },
    },
  },
  protocols: ["openai_image"],
};

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function parseRequestBody(ctx) {
  if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
  if (ctx.operation !== "generate") throw new Error("image edits are not supported");

  if (ctx.body.kind === "json") {
    if (!ctx.body.value || typeof ctx.body.value !== "object" || Array.isArray(ctx.body.value)) throw new Error("request body must be an object");
    return Object.assign({}, ctx.body.value);
  }

  const fields = ctx.body.fields || {};
  const request = {};
  for (const name of Object.keys(fields)) {
    if (!Array.isArray(fields[name]) || fields[name].length !== 1) throw new Error(name + " must be provided once");
    request[name] = fields[name][0];
  }
  if ((ctx.body.files || []).length > 0) throw new Error("image inputs are not supported");
  for (const key of ["n", "seed"]) {
    if (request[key] !== undefined) request[key] = Number(request[key]);
  }
  return request;
}

function normalizedRequest(value) {
  const request = value;
  const supported = ["model", "prompt", "negative_prompt", "n", "size", "response_format", "seed"];
  for (const key of Object.keys(request)) {
    if (!supported.includes(key)) {
      if (key === "image" || key === "images" || key === "mask") throw new Error("image inputs are not supported");
      throw new Error(key + " is not supported");
    }
  }
  if (typeof request.prompt !== "string") throw new Error("prompt must be a string");
  const prompt = trimmed(request.prompt);
  if (!prompt) throw new Error("prompt is required");
  if (request.negative_prompt !== undefined && typeof request.negative_prompt !== "string") throw new Error("negative_prompt must be a string");

  const count = request.n === undefined || request.n === null ? 1 : request.n;
  if (typeof count !== "number") throw new Error("n must be a number");
  if (!Number.isInteger(count) || count !== 1) throw new Error("n must be 1 for Qwen-Image-2.1");

  const size = request.size === undefined || request.size === "" ? "1024x1024" : trimmed(request.size).replace(/\*/g, "x");
  if (size !== "1024x1024") throw new Error("size must be 1024x1024");

  const responseFormat = request.response_format === undefined ? "url" : trimmed(request.response_format);
  if (responseFormat !== "url" && responseFormat !== "b64_json") throw new Error("response_format must be url or b64_json");

  const seed = request.seed === undefined ? 42 : request.seed;
  if (typeof seed !== "number") throw new Error("seed must be a number");
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("seed must be a non-negative safe integer");
  return {
    prompt,
    negative_prompt: request.negative_prompt === undefined ? "" : request.negative_prompt,
    n: count,
    size,
    response_format: responseFormat,
    seed,
  };
}

function workflowFor(request) {
  return {
    "451": { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    "452": {
      class_type: "TextEncodeQwenImage21",
      inputs: { prompt: request.prompt, negative_prompt: request.negative_prompt, resolution: 1024, clip: ["453", 0] },
    },
    "453": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16.safetensors", type: "qwen_image", device: "default" } },
    "454": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "456": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "457": { class_type: "VAEDecode", inputs: { samples: ["458", 0], vae: ["454", 0] } },
    "458": {
      class_type: "KSampler",
      inputs: {
        seed: request.seed,
        steps: 25,
        cfg: 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: ["480", 0],
        positive: ["452", 0],
        negative: ["452", 1],
        latent_image: ["456", 0],
      },
    },
    "461": {
      class_type: "SaveImageAdvanced",
      inputs: {
        filename_prefix: "Qwen_image_2.1",
        format: "png",
        "format.bit_depth": "8-bit",
        "format.input_color_space": "sRGB",
        images: ["457", 0],
      },
    },
    "480": { class_type: "QwenImage21Cache", inputs: { device: "auto", dtype: "default", model: ["451", 0] } },
  };
}

export function buildSubmitRequest(ctx) {
  const request = normalizedRequest(ctx.requestBody);
  return {
    url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/prompt",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: { prompt: workflowFor(request), client_id: ctx.publicTaskId },
    action: "text_to_image",
  };
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

function historyEntry(data, taskId, allowOnlyEntry) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (taskId && data[taskId] && typeof data[taskId] === "object" && !Array.isArray(data[taskId])) return data[taskId];
  const keys = Object.keys(data);
  return allowOnlyEntry && keys.length === 1 && data[keys[0]] && typeof data[keys[0]] === "object" && !Array.isArray(data[keys[0]]) ? data[keys[0]] : null;
}

function validImageOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const filename = trimmed(value.filename);
  const subfolder = String(value.subfolder || "");
  const type = String(value.type || "output");
  if (!filename || !/\.png$/i.test(filename) || /[\\/]/.test(filename) || filename.includes("\0")) return null;
  if (
    /\\/.test(subfolder) ||
    subfolder.includes("\0") ||
    (subfolder && subfolder.split("/").some(function (part) {
      return part === "" || part === "." || part === "..";
    }))
  )
    return null;
  if (type !== "output") return null;
  return { filename, subfolder, type };
}

function imageOutput(data, taskId, allowOnlyEntry) {
  const entry = historyEntry(data, taskId, allowOnlyEntry);
  const outputs = entry && entry.outputs;
  const save = outputs && typeof outputs === "object" && !Array.isArray(outputs) ? outputs[outputNodeId] : null;
  const images = save && Array.isArray(save.images) ? save.images : null;
  if (!images || images.length !== 1) return null;
  return validImageOutput(images[0]);
}

export function parseTaskResult(ctx, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: "UNKNOWN", reason: "unrecognized ComfyUI history" };
  if (Object.keys(body).length === 0) return { status: "IN_PROGRESS" };
  const entry = historyEntry(body, ctx.taskId, false);
  if (!entry) return { status: "UNKNOWN", reason: "unrecognized ComfyUI history" };
  const status = entry.status && typeof entry.status === "object" ? entry.status : {};
  const statusText = String(status.status_str || "").toLowerCase();
  if (["error", "failed", "interrupted"].includes(statusText)) return { status: "FAILURE", reason: "ComfyUI task failed" };
  if (status.completed === true || statusText === "success") {
    if (!imageOutput(body, ctx.taskId, false)) return { status: "FAILURE", progress: "100%", reason: "image output is missing" };
    return { status: "SUCCESS", progress: "100%" };
  }
  if (["running", "pending", "queued"].includes(statusText) || status.completed === false) return { status: "IN_PROGRESS" };
  return { status: "UNKNOWN", reason: "unrecognized ComfyUI history" };
}

export function extractUsage(ctx) {
  normalizedRequest(ctx.requestBody);
  return { image_count: 1 };
}

export function listArtifacts(task) {
  if (String(task.status || "").toUpperCase() !== "SUCCESS" || !imageOutput(task.data, "", true)) return [];
  return [{ key: "image", type: "image", mimeType: "image/png" }];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "image") throw new Error("artifact_not_found");
  const output = imageOutput(ctx.data, "", true);
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
  openai_image: {
    decodeRequest: function (ctx) {
      const request = normalizedRequest(parseRequestBody(ctx));
      return { kind: "submit", model: ctx.model, action: "text_to_image", requestBody: request };
    },
    render: function (ctx) {
      const artifact = ctx.artifacts && ctx.artifacts.image;
      if (!artifact || typeof artifact.url !== "string" || !artifact.url) throw new Error("image output is missing");
      return { data: [{ url: artifact.url }] };
    },
  },
};
