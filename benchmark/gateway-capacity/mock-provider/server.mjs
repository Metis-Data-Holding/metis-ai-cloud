import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({
  model: 'mock-sleep-1s',
  delayMs: 1000,
  ttftMs: 100,
  chunkIntervalMs: 100,
  chunkCount: 4,
  port: 8080,
  host: '0.0.0.0',
  maxBodyBytes: 1024 * 1024,
});

const LIMITS = Object.freeze({
  delayMs: { min: 0, max: 30_000 },
  ttftMs: { min: 0, max: 10_000 },
  chunkIntervalMs: { min: 0, max: 10_000 },
  chunkCount: { min: 1, max: 32 },
  port: { min: 1024, max: 65_535 },
  maxBodyBytes: { min: 1024, max: 10 * 1024 * 1024 },
});

function boundedInteger(value, fallback, { min, max }) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < min) return fallback;
  return Math.min(max, parsed);
}

function readInteger(options, env, optionName, envName, fallback, limit) {
  if (Object.hasOwn(options, optionName)) {
    return boundedInteger(options[optionName], fallback, limit);
  }
  if (Object.hasOwn(env, envName)) {
    return boundedInteger(env[envName], fallback, limit);
  }
  return fallback;
}

function safeModel(value) {
  const model = String(value ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(model) ? model : DEFAULTS.model;
}

function safeHost(value) {
  const host = String(value ?? '').trim();
  return host && host.length <= 253 ? host : DEFAULTS.host;
}

function booleanSetting(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function resolveConfig(options = {}) {
  const env = options.env ?? process.env;
  const modelValue = Object.hasOwn(options, 'model')
    ? options.model
    : env.MOCK_MODEL ?? DEFAULTS.model;
  const hasInjectedLogger = typeof options.logger === 'function';
  const logRequests = Object.hasOwn(options, 'logRequests')
    ? booleanSetting(options.logRequests, false)
    : Object.hasOwn(env, 'MOCK_LOG_REQUESTS')
      ? booleanSetting(env.MOCK_LOG_REQUESTS, false)
      : hasInjectedLogger;

  return Object.freeze({
    model: safeModel(modelValue),
    delayMs: readInteger(options, env, 'delayMs', 'MOCK_DELAY_MS', DEFAULTS.delayMs, LIMITS.delayMs),
    ttftMs: readInteger(options, env, 'ttftMs', 'MOCK_TTFT_MS', DEFAULTS.ttftMs, LIMITS.ttftMs),
    chunkIntervalMs: readInteger(
      options,
      env,
      'chunkIntervalMs',
      'MOCK_CHUNK_INTERVAL_MS',
      DEFAULTS.chunkIntervalMs,
      LIMITS.chunkIntervalMs,
    ),
    chunkCount: readInteger(options, env, 'chunkCount', 'MOCK_CHUNK_COUNT', DEFAULTS.chunkCount, LIMITS.chunkCount),
    // Port 0 is useful for tests when it is passed directly, but never accepted from environment configuration.
    port: Object.hasOwn(options, 'port')
      ? options.port === 0
        ? 0
        : boundedInteger(options.port, DEFAULTS.port, LIMITS.port)
      : readInteger(options, env, 'port', 'MOCK_PORT', DEFAULTS.port, LIMITS.port),
    host: safeHost(Object.hasOwn(options, 'host') ? options.host : env.MOCK_HOST ?? DEFAULTS.host),
    maxBodyBytes: readInteger(
      options,
      env,
      'maxBodyBytes',
      'MOCK_MAX_BODY_BYTES',
      DEFAULTS.maxBodyBytes,
      LIMITS.maxBodyBytes,
    ),
    logRequests,
    logger: typeof options.logger === 'function' ? options.logger : (entry) => console.log(JSON.stringify(entry)),
  });
}

class RequestCancelledError extends Error {}

function waitFor(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(new RequestCancelledError('request cancelled'));

  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new RequestCancelledError('request cancelled'));
    };

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function requestPath(request) {
  try {
    return new URL(request.url ?? '/', 'http://mock-provider.local').pathname;
  } catch {
    return null;
  }
}

function logRequest(config, details) {
  if (!config.logRequests) return;
  try {
    config.logger({ event: 'request', ...details });
  } catch {
    // A logging failure must not change the provider response.
  }
}

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function writeError(response, status, message, type = 'invalid_request_error') {
  writeJson(response, status, { error: { message, type } });
}

class PayloadTooLargeError extends Error {}

function readRequestBody(request, maxBytes) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        rejectOnce(new PayloadTooLargeError('request body exceeds the configured limit'));
        request.resume();
        return;
      }
      if (!settled) chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', rejectOnce);
    request.on('aborted', () => rejectOnce(new Error('request aborted')));
  });
}

function validateChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'request body must be a JSON object';
  }
  if (typeof body.model !== 'string' || body.model.trim() === '') {
    return 'model is required';
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'messages must be a non-empty array';
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') {
    return 'stream must be a boolean';
  }
  return null;
}

function usageFor(body, completionTokens) {
  const promptTokens = Math.max(1, body.messages.length);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function createCompletion(config, requestId, body) {
  const content = `Mock response after ${config.delayMs}ms.`;
  return {
    id: `chatcmpl-mock-${requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: config.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: usageFor(body, content.split(/\s+/).length),
  };
}

async function writeStreamingCompletion(response, config, requestId, body, signal) {
  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  response.flushHeaders();

  await waitFor(config.ttftMs, signal);
  const completionTokens = config.chunkCount;

  for (let index = 0; index < config.chunkCount; index += 1) {
    if (response.destroyed) return;
    if (index > 0) await waitFor(config.chunkIntervalMs, signal);

    const chunk = {
      id: `chatcmpl-mock-${requestId}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: config.model,
      choices: [
        {
          index: 0,
          delta: {
            ...(index === 0 ? { role: 'assistant' } : {}),
            content: `mock chunk ${index + 1}`,
          },
          finish_reason: index === config.chunkCount - 1 ? 'stop' : null,
        },
      ],
      ...(index === config.chunkCount - 1 ? { usage: usageFor(body, completionTokens) } : {}),
    };
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  if (!response.destroyed) {
    response.write('data: [DONE]\n\n');
    response.end();
  }
}

async function handleRequest(request, response, config) {
  const requestId = randomUUID();
  const pathname = requestPath(request);
  const requestController = new AbortController();
  const onRequestAbort = () => requestController.abort();
  const onResponseClose = () => {
    if (!response.writableEnded) requestController.abort();
  };
  request.once('aborted', onRequestAbort);
  response.once('close', onResponseClose);
  let status = 404;
  let stream = false;

  try {
    if (request.method === 'GET' && pathname === '/health') {
      status = 200;
      writeJson(response, status, { status: 'ok', model: config.model });
      logRequest(config, { requestId, method: request.method, route: 'health', status });
      return;
    }

    if (request.method === 'GET' && pathname === '/v1/models') {
      status = 200;
      writeJson(response, status, {
        object: 'list',
        data: [
          {
            id: config.model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'gateway-capacity-mock',
          },
        ],
      });
      logRequest(config, { requestId, method: request.method, route: 'models', status });
      return;
    }

    if (request.method !== 'POST' || pathname !== '/v1/chat/completions') {
      writeError(response, status, 'route not found', 'not_found_error');
      logRequest(config, { requestId, method: request.method, route: 'not-found', status });
      return;
    }

    let body;
    try {
      const rawBody = await readRequestBody(request, config.maxBodyBytes);
      body = JSON.parse(rawBody);
    } catch (error) {
      status = error instanceof PayloadTooLargeError ? 413 : 400;
      writeError(
        response,
        status,
        error instanceof PayloadTooLargeError ? error.message : 'request body must be valid JSON',
        'invalid_request_error',
      );
      logRequest(config, { requestId, method: request.method, route: 'chat-completions', status });
      return;
    }

    const validationError = validateChatRequest(body);
    if (validationError) {
      status = 400;
      writeError(response, status, validationError);
      logRequest(config, { requestId, method: request.method, route: 'chat-completions', status });
      return;
    }

    stream = body.stream === true;
    if (stream) {
      try {
        await writeStreamingCompletion(response, config, requestId, body, requestController.signal);
      } catch (error) {
        if (!(error instanceof RequestCancelledError)) throw error;
        logRequest(config, {
          requestId,
          method: request.method,
          route: 'chat-completions',
          status: 499,
          stream,
          cancelled: true,
        });
        return;
      }
      logRequest(config, { requestId, method: request.method, route: 'chat-completions', status: 200, stream });
      return;
    }

    try {
      await waitFor(config.delayMs, requestController.signal);
    } catch (error) {
      if (!(error instanceof RequestCancelledError)) throw error;
      logRequest(config, {
        requestId,
        method: request.method,
        route: 'chat-completions',
        status: 499,
        stream,
        cancelled: true,
      });
      return;
    }
    if (response.destroyed) return;
    status = 200;
    writeJson(response, status, createCompletion(config, requestId, body));
    logRequest(config, {
      requestId,
      method: request.method,
      route: 'chat-completions',
      status,
      stream,
      delayMs: config.delayMs,
    });
  } finally {
    request.off('aborted', onRequestAbort);
    response.off('close', onResponseClose);
  }
}

export function createMockServer(options = {}) {
  const config = resolveConfig(options);
  const server = http.createServer((request, response) => {
    handleRequest(request, response, config).catch(() => {
      if (!response.headersSent) writeError(response, 500, 'mock provider internal error', 'server_error');
      if (!response.writableEnded) response.end();
      logRequest(config, {
        requestId: randomUUID(),
        method: request.method,
        route: 'internal-error',
        status: 500,
      });
    });
  });

  server.mockConfig = config;
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;
  return server;
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectInvocation()) {
  const server = createMockServer();
  const { host, port } = server.mockConfig;
  server.on('error', (error) => {
    console.error(`mock provider failed to listen: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(JSON.stringify({ event: 'listening', host, port }));
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
