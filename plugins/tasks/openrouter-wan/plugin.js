export const meta = {
  apiVersion: 1,
  key: "openrouter-wan",
  name: "OpenRouter Wan",
  description: {
    en: "OpenRouter Alibaba Wan video generation with first-frame and reference image input",
    zh: "通过 OpenRouter 接入阿里 Wan 文生视频、首帧与参考图生视频",
  },
  version: "1.1.0",
  author: { name: "Metis Data" },
  baseUrl: "https://openrouter.ai/api",
  auth: { type: "api_key" },
  models: ["alibaba/wan-3.0", "alibaba/wan-3.0-prime"],
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation duration unit price", zh: "视频生成时长单价" },
    },
    resolution: {
      enum: ["480p", "720p", "1080p"],
      enumLabels: {
        "480p": { en: "480p", zh: "480p" },
        "720p": { en: "720p", zh: "720p" },
        "1080p": { en: "1080p", zh: "1080p" },
      },
      description: { en: "Output video resolution", zh: "输出视频分辨率" },
    },
  },
  protocols: ["openai_video"],
};

const models = new Set(meta.models);
const resolutions = new Set(["480p", "720p", "1080p"]);
const ratios = new Set(["16:9", "4:3", "1:1", "3:4", "9:16"]);
const firstFramePattern = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/;
const maxFirstFrameBytes = 30 * 1024 * 1024;

function trimmed(value) {
  return String(value || "").trim();
}

function metadataObject(request) {
  const metadata = request && request.metadata;
  if (metadata === undefined) return {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
  return metadata;
}

function contentImage(metadata, model) {
  if (!Object.prototype.hasOwnProperty.call(metadata, "content")) return null;
  if (!Array.isArray(metadata.content)) throw new Error("metadata content must be an array");
  if (metadata.content.length === 0) return null;
  if (
    metadata.content.length !== 1 ||
    !metadata.content[0] ||
    typeof metadata.content[0] !== "object" ||
    Array.isArray(metadata.content[0]) ||
    metadata.content[0].type !== "image_url"
  ) {
    throw new Error("only one first_frame image is supported");
  }
  const role = metadata.content[0].role;
  if (role === "reference_image" && model !== "alibaba/wan-3.0") {
    throw new Error("reference images are not supported by " + model);
  }
  if (role !== "first_frame" && role !== "reference_image") {
    throw new Error("only one first_frame image is supported");
  }
  const image = metadata.content[0].image_url;
  const url = image && typeof image === "object" ? trimmed(image.url) : "";
  const match = firstFramePattern.exec(url);
  if (!match || match[1].length % 4 !== 0) throw new Error(role + " must be an image data URL");
  const padding = match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0;
  const decodedBytes = (match[1].length / 4) * 3 - padding;
  if (decodedBytes > maxFirstFrameBytes) throw new Error(role + " must not exceed 30 MB");
  return { role, url };
}

function normalizedRequest(request, model) {
  const req = request || {};
  const metadata = metadataObject(req);
  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("prompt is required");
  const durationValue = req.seconds === undefined ? req.duration : req.seconds;
  const duration = durationValue === undefined ? 5 : Number(durationValue);
  if (!Number.isInteger(duration) || duration < 2 || duration > 30) throw new Error("duration must be an integer between 2 and 30");
  const resolution = trimmed(req.resolution || metadata.resolution || "720p").toLowerCase();
  if (!resolutions.has(resolution)) throw new Error("resolution must be one of 480p, 720p, 1080p");
  const ratio = trimmed(req.aspect_ratio || req.ratio || metadata.aspect_ratio || metadata.ratio || "16:9");
  if (!ratios.has(ratio)) throw new Error("ratio must be one of 16:9, 4:3, 1:1, 3:4, 9:16");
  const generateAudio = req.generate_audio === undefined ? metadata.generate_audio === true : req.generate_audio === true;
  const contentImageValue = contentImage(metadata, model);
  if (
    req.input_references !== undefined ||
    req.frame_images !== undefined ||
    req.images !== undefined ||
    req.input_reference !== undefined ||
    req.input_last_frame !== undefined
  ) {
    throw new Error("reference content is not supported");
  }
  const normalized = { prompt, duration, resolution, aspect_ratio: ratio, generate_audio: generateAudio };
  if (contentImageValue && contentImageValue.role === "first_frame") normalized.frame_image = contentImageValue.url;
  if (contentImageValue && contentImageValue.role === "reference_image") normalized.reference_image = contentImageValue.url;
  if (req.seed !== undefined) {
    const seed = Number(req.seed);
    if (!Number.isInteger(seed) || seed < 0) throw new Error("seed must be a non-negative integer");
    normalized.seed = seed;
  }
  const action = normalized.reference_image ? "reference_to_video" : normalized.frame_image ? "image_to_video" : "text_to_video";
  return { model, action, request: normalized };
}

function endpoint(ctx, suffix) {
  return String(ctx.baseUrl || "").replace(/\/$/, "") + suffix;
}

export function buildSubmitRequest(ctx) {
  const request = ctx.requestBody || {};
  const body = {
    model: ctx.upstreamModel || ctx.model,
    prompt: request.prompt,
    duration: request.duration,
    resolution: request.resolution,
    aspect_ratio: request.aspect_ratio,
    generate_audio: request.generate_audio,
  };
  if (request.seed !== undefined) body.seed = request.seed;
  if (request.frame_image) {
    body.frame_images = [
      {
        type: "image_url",
        image_url: { url: request.frame_image },
        frame_type: "first_frame",
      },
    ];
  }
  if (request.reference_image) {
    body.input_references = [
      {
        type: "image_url",
        image_url: { url: request.reference_image },
      },
    ];
  }
  return {
    url: endpoint(ctx, "/v1/videos"),
    method: "POST",
    headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json" },
    body,
    action: request.reference_image ? "reference_to_video" : request.frame_image ? "image_to_video" : "text_to_video",
  };
}

export function parseSubmitResponse(_ctx, response) {
  const body = (response && response.body) || {};
  const taskId = trimmed(body.id);
  if (!taskId) throw new Error("OpenRouter did not return a video id");
  return { taskId, taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: endpoint(ctx, "/v1/videos/" + encodeURIComponent(ctx.taskId)),
    method: "GET",
    headers: { Authorization: "Bearer " + ctx.apiKey, Accept: "application/json" },
  };
}

export function parseTaskResult(_ctx, body) {
  const statuses = {
    queued: "SUBMITTED",
    pending: "SUBMITTED",
    processing: "IN_PROGRESS",
    in_progress: "IN_PROGRESS",
    completed: "SUCCESS",
    failed: "FAILURE",
    cancelled: "FAILURE",
    canceled: "FAILURE",
    expired: "FAILURE",
  };
  const rawStatus = trimmed(body && body.status).toLowerCase();
  const status = statuses[rawStatus];
  if (!status) return { status: "UNKNOWN", reason: "unrecognized status: " + rawStatus };
  const result = { status };
  const progress = Number(body && body.progress);
  if (Number.isFinite(progress) && progress >= 0 && progress <= 100) result.progress = progress + "%";
  if (status === "FAILURE") {
    const error = body && body.error;
    result.reason = trimmed(error && typeof error === "object" ? error.message : error) || "video generation failed";
  }
  return result;
}

export function extractUsage(ctx) {
  const request = normalizedRequest(ctx.requestBody, ctx.upstreamModel || ctx.model).request;
  return { seconds: request.duration, resolution: request.resolution };
}

export function listArtifacts(task) {
  return String((task && task.status) || "").toUpperCase() === "SUCCESS" ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  return {
    url: endpoint(ctx, "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content"),
    method: ctx.clientRequest && ctx.clientRequest.method === "HEAD" ? "HEAD" : "GET",
    headers: { Authorization: "Bearer " + ctx.apiKey },
  };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const body = ctx.body.value;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object required");
      const requestedModel = trimmed(body.model);
      const model = trimmed(ctx.model) || requestedModel;
      const upstreamModel = trimmed(ctx.upstreamModel) || model;
      if (!models.has(upstreamModel)) throw new Error("unsupported Wan model: " + upstreamModel);
      if (requestedModel && requestedModel !== model) throw new Error("model does not match the selected endpoint");
      const normalized = normalizedRequest(body, upstreamModel);
      return {
        kind: "submit",
        model,
        action: normalized.action,
        requestBody: normalized.request,
      };
    },
    render: function (task) {
      const statusMap = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
      const output = {
        id: task.task_id,
        object: "video",
        model: (task.properties || {}).origin_model_name || "",
        status: statusMap[task.status] || "unknown",
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: Number(task.created_at || 0),
      };
      const completedAt = Number(task.finished_at || task.updated_at || 0);
      if (completedAt > 0) output.completed_at = completedAt;
      if (task.status === "FAILURE") output.error = { code: "video_generation_failed", message: task.fail_reason || "The video generation task failed." };
      return output;
    },
  },
};
