export const meta = {
  apiVersion: 1,
  key: "minimax-h3",
  name: "MiniMax H3",
  icon: "Minimax.Color",
  description: {
    en: "Self-hosted MiniMax H3 text, reference, first-frame, and first-and-last-frame video through ComfyUI",
    zh: "通过 ComfyUI 接入自托管 MiniMax H3 文生、参考内容、首帧及首尾帧图生视频",
  },
  version: "1.3.0",
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
const maxFrameBytes = 30 * 1024 * 1024;
const maxCombinedFrameBytes = 45 * 1024 * 1024;
const maxReferenceVideoBytes = 64 * 1024 * 1024;
const videoExtensions = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function frameMarker(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 1 || value.__fileRef !== "request_file:" + field) return null;
  return value;
}

function frameSize(frameFiles, field) {
  const fileSize = Number(frameFiles[0].size);
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize >= maxFrameBytes) {
    throw new Error(field + " must be smaller than 30 MiB");
  }
  return fileSize;
}

function referenceMarker(request, field) {
  if (request[field] === undefined) return null;
  const marker = frameMarker(request[field], field);
  if (!marker) throw new Error("reference content is not supported");
  return marker;
}

function normalizedRequest(request) {
  const req = request || {};
  const metadata = req.metadata && typeof req.metadata === "object" && !Array.isArray(req.metadata) ? req.metadata : {};
  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("prompt is required");
  if (Object.prototype.hasOwnProperty.call(metadata, "content") || req.images !== undefined) throw new Error("reference content is not supported");
  let inputReference;
  if (req.input_reference !== undefined) {
    inputReference = frameMarker(req.input_reference, "input_reference");
    if (!inputReference) throw new Error("reference content is not supported");
  }
  let inputLastFrame;
  if (req.input_last_frame !== undefined) {
    inputLastFrame = frameMarker(req.input_last_frame, "input_last_frame");
    if (!inputLastFrame) throw new Error("reference content is not supported");
    if (!inputReference) throw new Error("input_last_frame requires input_reference");
  }
  const referenceImage0 = referenceMarker(req, "reference_image_0");
  const referenceImage1 = referenceMarker(req, "reference_image_1");
  const referenceVideo0 = referenceMarker(req, "reference_video_0");
  if (referenceImage1 && !referenceImage0) throw new Error("reference_image_1 requires reference_image_0");
  if ((referenceImage0 || referenceImage1 || referenceVideo0) && (inputReference || inputLastFrame)) {
    throw new Error("reference content cannot be combined with keyframes");
  }

  const rawDuration = req.duration === undefined ? req.seconds : req.duration;
  const duration = rawDuration === undefined ? 5 : Number(rawDuration);
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) throw new Error("duration must be an integer between 5 and 15");

  const resolution = String(req.resolution || metadata.resolution || "768p").toLowerCase();
  if (resolution !== "768p") throw new Error("resolution must be 768p");
  const ratio = String(req.ratio || metadata.ratio || "16:9");
  if (!sizes[ratio]) throw new Error("ratio must be one of 16:9, 9:16, 1:1, 4:3, 3:4");
  const generateAudio = req.generate_audio === undefined ? metadata.generate_audio === true : req.generate_audio === true;
  return {
    prompt,
    duration,
    resolution,
    ratio,
    generate_audio: generateAudio,
    input_reference: inputReference,
    input_last_frame: inputLastFrame,
    reference_image_0: referenceImage0,
    reference_image_1: referenceImage1,
    reference_video_0: referenceVideo0,
  };
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

function baseWorkflow(request, publicTaskId, modelName, conditioning, size) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: modelName, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
    4: {
      class_type: conditioning.class_type,
      inputs: {
        ...conditioning.inputs,
        clip: ["2", 0],
        vae: ["3", 0],
        prompt: request.prompt,
        width: size[0],
        height: size[1],
        length: frameCount(request.duration),
      },
    },
    5: { class_type: "RandomNoise", inputs: { noise_seed: taskSeed(publicTaskId) } },
    6: { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    7: { class_type: "BasicScheduler", inputs: { model: ["1", 0], scheduler: "simple", steps: 20, denoise: 1 } },
    8: { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: ["4", 0] } },
    9: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["5", 0], guider: ["8", 0], sampler: ["6", 0], sigmas: ["7", 0], latent_image: ["4", 1] } },
    10: { class_type: "VAEDecode", inputs: { samples: ["9", 1], vae: ["3", 0] } },
    11: { class_type: "CreateVideo", inputs: { images: ["10", 0], fps: 24, bit_depth: 8, color_space: "sRGB" } },
    12: { class_type: "SaveVideo", inputs: { video: ["11", 0], filename_prefix: "MiniMaxH3", format: "auto", codec: "auto" } },
  };
}

function workflowFor(request, publicTaskId, firstFrame, lastFrame, referenceImages, referenceVideo) {
  const size = sizes[request.ratio];
  const hasReferences = referenceImages.length > 0 || Boolean(referenceVideo);
  const workflow = hasReferences
    ? baseWorkflow(
        request,
        publicTaskId,
        "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        {
          class_type: "MiniMaxH3ReferenceToVideo",
          inputs: { ref_image_size: "match" },
        },
        size
      )
    : baseWorkflow(
        request,
        publicTaskId,
        "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
        {
          class_type: "MiniMaxH3ImageToVideo",
          inputs: {},
        },
        size
      );
  if (firstFrame) {
    workflow[15] = { class_type: "LoadImage", inputs: { image: firstFrame.filename + " [temp]" } };
    workflow[4].inputs.first_frame = ["15", 0];
  }
  if (lastFrame) {
    workflow[16] = { class_type: "LoadImage", inputs: { image: lastFrame.filename + " [temp]" } };
    workflow[4].inputs.last_frame = ["16", 0];
  }
  if (hasReferences) {
    if (referenceImages[0]) {
      workflow[14] = { class_type: "LoadImage", inputs: { image: referenceImages[0].filename + " [temp]" } };
      workflow[4].inputs["ref_images.ref_image_0"] = ["14", 0];
    }
    if (referenceImages[1]) {
      workflow[15] = { class_type: "LoadImage", inputs: { image: referenceImages[1].filename + " [temp]" } };
      workflow[4].inputs["ref_images.ref_image_1"] = ["15", 0];
    }
    if (referenceVideo) {
      workflow[16] = {
        class_type: "VHS_LoadVideo",
        inputs: {
          video: referenceVideo.filename,
          force_rate: 24,
          custom_width: 0,
          custom_height: 0,
          frame_load_cap: 360,
          skip_first_frames: 0,
          select_every_nth: 1,
          format: "AnimateDiff",
        },
      };
      workflow[4].inputs["ref_videos.ref_video_0"] = ["16", 0];
    }
    workflow[10].inputs.samples = ["9", 0];
    workflow[13] = { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } };
    workflow[4].inputs.audio_vae = ["13", 0];
  }
  if (request.generate_audio) {
    const audioDecodeNode = hasReferences ? 17 : 14;
    if (!hasReferences) workflow[13] = { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } };
    workflow[audioDecodeNode] = { class_type: "VAEDecodeAudio", inputs: { samples: ["9", hasReferences ? 0 : 1], vae: ["13", 0] } };
    workflow[11].inputs.audio = [String(audioDecodeNode), 0];
  }
  return workflow;
}

export function buildSubmitRequest(ctx) {
  const request = normalizedRequest(ctx.requestBody);
  const files = (ctx.files || []).filter(function (file) {
    return file && typeof file === "object";
  });
  const firstFiles = files.filter(function (file) {
    return file.field === "input_reference";
  });
  const lastFiles = files.filter(function (file) {
    return file.field === "input_last_frame";
  });
  const referenceImageFiles = [0, 1].map(function (index) {
    return files.filter(function (file) {
      return file.field === "reference_image_" + index;
    });
  });
  const referenceVideoFiles = files.filter(function (file) {
    return file.field === "reference_video_0";
  });
  const unexpectedFile = files.find(function (file) {
    return !["input_reference", "input_last_frame", "reference_image_0", "reference_image_1", "reference_video_0"].includes(file.field);
  });
  if (unexpectedFile) throw new Error("unexpected file field: " + unexpectedFile.field);
  let firstFrame = null;
  let lastFrame = null;
  const frame = function (marker, frameFiles, field, suffix) {
    if (!marker) {
      if (frameFiles.length > 0) throw new Error("unexpected " + field + " file");
      return null;
    }
    if (frameFiles.length !== 1 || frameFiles[0].ref !== marker.__fileRef) throw new Error(field + " file is missing");
    const mimeType = String(frameFiles[0].mimeType || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(imageExtensions, mimeType)) throw new Error(field + " must be image/jpeg, image/png, or image/webp");
    const fileSize = frameSize(frameFiles, field);
    const extension = imageExtensions[mimeType];
    const taskID =
      trimmed(ctx.publicTaskId)
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "task";
    return { ref: frameFiles[0].ref, filename: "minimax-h3-" + taskID + suffix + "." + extension, size: fileSize };
  };
  firstFrame = frame(request.input_reference, firstFiles, "input_reference", "");
  lastFrame = frame(request.input_last_frame, lastFiles, "input_last_frame", "-last-frame");
  if (firstFrame && lastFrame && firstFrame.size + lastFrame.size > maxCombinedFrameBytes) {
    throw new Error("input frames must not exceed 45 MiB in total");
  }
  const referenceImages = referenceImageFiles
    .map(function (frameFiles, index) {
      const marker = request["reference_image_" + index];
      if (!marker) {
        if (frameFiles.length > 0) throw new Error("unexpected reference_image_" + index + " file");
        return null;
      }
      if (frameFiles.length !== 1 || frameFiles[0].ref !== marker.__fileRef) throw new Error("reference_image_" + index + " file is missing");
      const mimeType = String(frameFiles[0].mimeType || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(imageExtensions, mimeType)) throw new Error("reference images must be image/jpeg, image/png, or image/webp");
      const size = frameSize(frameFiles, "reference_image_" + index);
      const taskID =
        trimmed(ctx.publicTaskId)
          .replace(/[^A-Za-z0-9_-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80) || "task";
      return { ref: frameFiles[0].ref, filename: "minimax-h3-" + taskID + "-reference-" + index + "." + imageExtensions[mimeType], size: size };
    })
    .filter(Boolean);
  const referenceVideo = request.reference_video_0
    ? (function () {
        if (referenceVideoFiles.length !== 1 || referenceVideoFiles[0].ref !== request.reference_video_0.__fileRef)
          throw new Error("reference_video_0 file is missing");
        const mimeType = String(referenceVideoFiles[0].mimeType || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(videoExtensions, mimeType)) throw new Error("reference video must be video/mp4 or video/quicktime");
        const size = Number(referenceVideoFiles[0].size);
        if (!Number.isFinite(size) || size <= 0 || size > maxReferenceVideoBytes) throw new Error("reference video must not exceed 64 MiB");
        const taskID =
          trimmed(ctx.publicTaskId)
            .replace(/[^A-Za-z0-9_-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 80) || "task";
        return { ref: referenceVideoFiles[0].ref, filename: "minimax-h3-" + taskID + "-reference-video." + videoExtensions[mimeType], size: size };
      })()
    : null;
  if (!request.reference_video_0 && referenceVideoFiles.length > 0) throw new Error("unexpected reference_video_0 file");
  if (
    referenceImages.length > 0 &&
    referenceImages.reduce(function (total, image) {
      return total + image.size;
    }, 0) > maxCombinedFrameBytes
  )
    throw new Error("reference images must not exceed 45 MiB in total");
  if (referenceImages.length + Number(Boolean(referenceVideo)) > 0 && (firstFrame || lastFrame))
    throw new Error("reference content cannot be combined with keyframes");
  const descriptor = {
    url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/prompt",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: { prompt: workflowFor(request, ctx.publicTaskId, firstFrame, lastFrame, referenceImages, referenceVideo) },
    action: referenceImages.length > 0 || referenceVideo ? "reference_to_video" : firstFrame ? "image_to_video" : "text_to_video",
  };
  const prepareRequest = function (frameInfo) {
    return {
      url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/upload/image",
      method: "POST",
      headers: { Accept: "application/json" },
      bodyType: "multipart",
      parts: [
        { name: "image", fileRef: frameInfo.ref, filename: frameInfo.filename },
        { name: "type", value: "temp" },
        { name: "overwrite", value: true },
      ],
    };
  };
  if (firstFrame && lastFrame) {
    descriptor.prepareRequests = [prepareRequest(firstFrame), prepareRequest(lastFrame)];
  } else if (firstFrame) {
    descriptor.prepareRequest = prepareRequest(firstFrame);
  }
  const referencePrepareRequest = function (fileInfo, type) {
    return {
      url: String(ctx.baseUrl || "").replace(/\/$/, "") + "/upload/image",
      method: "POST",
      headers: { Accept: "application/json" },
      bodyType: "multipart",
      parts: [
        { name: "image", fileRef: fileInfo.ref, filename: fileInfo.filename },
        { name: "type", value: type },
        { name: "overwrite", value: true },
      ],
    };
  };
  if (referenceImages.length > 0 || referenceVideo) {
    descriptor.prepareRequests = referenceImages.map(function (image) {
      return referencePrepareRequest(image, "temp");
    });
    if (referenceVideo) descriptor.prepareRequests.push(referencePrepareRequest(referenceVideo, "input"));
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
      let hasInputLastFrameFile = false;
      const referenceFileFields = ["reference_image_0", "reference_image_1", "reference_video_0"];
      const referenceFiles = new Set();
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
          if (file.field === "input_reference") {
            if (hasInputReferenceFile) throw new Error("input_reference must be provided once");
            hasInputReferenceFile = true;
          } else if (file.field === "input_last_frame") {
            if (hasInputLastFrameFile) throw new Error("input_last_frame must be provided once");
            hasInputLastFrameFile = true;
          } else if (referenceFileFields.includes(file.field)) {
            if (referenceFiles.has(file.field)) throw new Error(file.field + " must be provided once");
            referenceFiles.add(file.field);
          } else {
            throw new Error("unexpected file field: " + file.field);
          }
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
        if (hasInputLastFrameFile) req.input_last_frame = { __fileRef: "request_file:input_last_frame" };
        for (const field of referenceFileFields) {
          if (referenceFiles.has(field)) req[field] = { __fileRef: "request_file:" + field };
        }
      }
      const request = normalizedRequest(req);
      return {
        kind: "submit",
        model: ctx.model,
        action: request.reference_image_0 || request.reference_video_0 ? "reference_to_video" : request.input_reference ? "image_to_video" : "text_to_video",
        requestBody: request,
      };
    },
    render: function () {
      return {};
    },
  },
};
