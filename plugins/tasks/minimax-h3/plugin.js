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

function unavailable() {
  throw new Error("MiniMax H3 driver is not implemented");
}

export function buildSubmitRequest() {
  return unavailable();
}

export function parseSubmitResponse() {
  return unavailable();
}

export function buildQueryRequest() {
  return unavailable();
}

export function parseTaskResult() {
  return unavailable();
}

export function listArtifacts() {
  return [];
}

export function buildContentRequest() {
  return unavailable();
}

export const protocols = {
  openai_video: {
    decodeRequest: unavailable,
    render: function (_ctx, task) {
      return task;
    },
  },
};
