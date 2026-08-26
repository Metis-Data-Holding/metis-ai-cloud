import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { validateNonStreamResponse, validateStreamingResponse } from './validators.js';

export const gatewayHttpStatus = new Counter('gateway_http_status');
export const gatewayStatus2xx = new Counter('gateway_status_2xx');
export const gatewayStatus429 = new Counter('gateway_status_429');
export const gatewayStatus502 = new Counter('gateway_status_502');
export const gatewayStatus503 = new Counter('gateway_status_503');
export const gatewayStatus504 = new Counter('gateway_status_504');
export const gatewayStatusOther4xx = new Counter('gateway_status_other_4xx');
export const gatewayStatusOther5xx = new Counter('gateway_status_other_5xx');
export const gatewayStatusTransportError = new Counter('gateway_status_transport_error');
export const gatewayStatusOther = new Counter('gateway_status_other');
export const gatewayErrorRate = new Rate('gateway_error_rate');
export const gatewayProtocolValid = new Rate('gateway_protocol_valid');
export const gatewayE2ELatency = new Trend('gateway_e2e_latency');
// 这是 HTTP 响应头首字节的近似值，不是严格的模型 TTFT。
export const gatewayHttpTtfb = new Trend('gateway_http_ttfb');
export const gatewayOverheadDuration = new Trend('gateway_overhead_duration_ms');

export const smokeThresholds = {
  http_req_failed: ['rate<0.01'],
  gateway_error_rate: ['rate<0.01'],
  gateway_protocol_valid: ['rate>0.99'],
};

export const loadThresholds = {
  http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '10s' }],
  gateway_error_rate: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '10s' }],
  gateway_protocol_valid: [{ threshold: 'rate>0.99', abortOnFail: true, delayAbortEval: '10s' }],
};

export const nonStreamLoadThresholds = {
  ...loadThresholds,
  gateway_overhead_duration_ms: [{ threshold: 'p(95)<1000', abortOnFail: true, delayAbortEval: '10s' }],
};

// 这是 HTTP 响应头首字节的停止线，不是模型 Token TTFT。
export const streamingLoadThresholds = {
  ...loadThresholds,
  gateway_http_ttfb: [{ threshold: 'p(95)<1000', abortOnFail: true, delayAbortEval: '10s' }],
};

const target = __ENV.GATEWAY_CAPACITY_TARGET || 'https://invalid.local';
const model = __ENV.GATEWAY_CAPACITY_MODEL || 'mock-sleep-1s';
const apiKey = __ENV.GATEWAY_CAPACITY_API_KEY || '';

function boundedMockNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export const expectedMockConfig = {
  delayMs: boundedMockNumber(__ENV.MOCK_DELAY_MS, 1000, 0, 30000),
  ttftMs: boundedMockNumber(__ENV.MOCK_TTFT_MS, 100, 0, 10000),
  chunkIntervalMs: boundedMockNumber(__ENV.MOCK_CHUNK_INTERVAL_MS, 100, 0, 10000),
  chunkCount: boundedMockNumber(__ENV.MOCK_CHUNK_COUNT, 4, 1, 32),
};

const loadModel = __ENV.LOAD_MODEL || 'fixed-vu-closed-loop';

export const fixedPrompt = 'gateway-capacity mock request: return the fixed mock response.';

export function completionEndpoint() {
  const base = target.replace(/\/+$/, '');
  return /\/v1\/chat\/completions$/i.test(base) ? base : `${base}/v1/chat/completions`;
}

export function requestBody(stream) {
  return JSON.stringify({
    model,
    messages: [{ role: 'user', content: fixedPrompt }],
    stream,
    temperature: 0,
    max_tokens: 16,
  });
}

export function requestParams(stream, mode) {
  return {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    },
    timeout: __ENV.TIMEOUT || '30s',
    tags: { gateway_test_mode: mode, load_model: loadModel },
  };
}

function contentType(response) {
  return String(response.headers['Content-Type'] || response.headers['content-type'] || '').toLowerCase();
}

function recordStatus(response) {
  const status = Number(response.status || 0);
  if (status >= 200 && status < 300) gatewayStatus2xx.add(1);
  else if (status === 429) gatewayStatus429.add(1);
  else if (status === 502) gatewayStatus502.add(1);
  else if (status === 503) gatewayStatus503.add(1);
  else if (status === 504) gatewayStatus504.add(1);
  else if (status >= 400 && status < 500) gatewayStatusOther4xx.add(1);
  else if (status >= 500) gatewayStatusOther5xx.add(1);
  else if (status <= 0) gatewayStatusTransportError.add(1);
  else gatewayStatusOther.add(1);
}

export function observeResponse(response, { stream = false, mode = stream ? 'streaming' : 'non-stream' } = {}) {
  const statusOk = response.status === 200;
  const body = typeof response.body === 'string' ? response.body : '';
  const mockSourceOk = stream
    ? validateStreamingResponse(body, model)
    : validateNonStreamResponse(body, model);
  const protocolOk = stream
    ? contentType(response).includes('text/event-stream') && mockSourceOk
    : contentType(response).includes('application/json') && mockSourceOk;

  gatewayHttpStatus.add(1, { status: String(response.status || 0) });
  recordStatus(response);
  gatewayErrorRate.add(statusOk && protocolOk ? 0 : 1);
  gatewayProtocolValid.add(statusOk && protocolOk ? 1 : 0);
  const durationMs = Number(response.timings?.duration || 0);
  gatewayE2ELatency.add(durationMs);
  if (stream) {
    // k6 的 waiting 是到 HTTP 首字节的近似，不等同于模型严格 TTFT。
    gatewayHttpTtfb.add(Number(response.timings?.waiting || 0));
  } else {
    gatewayOverheadDuration.add(Math.max(0, durationMs - expectedMockConfig.delayMs));
  }

  return check(response, {
    [`${mode}: HTTP status is 200`]: () => statusOk,
    [`${mode}: response protocol and Mock source are valid`]: () => protocolOk,
  });
}

export function postCompletion(stream, mode) {
  const response = http.post(completionEndpoint(), requestBody(stream), requestParams(stream, mode));
  observeResponse(response, { stream, mode });
  return response;
}
