import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMockServer } from './server.mjs';

const activeServers = new Set();

async function startServer(options = {}) {
  const server = createMockServer({
    delayMs: 20,
    ttftMs: 10,
    chunkIntervalMs: 5,
    chunkCount: 3,
    logger: () => {},
    ...options,
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  activeServers.add(server);

  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

async function stopServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  activeServers.delete(server);
}

afterEach(async () => {
  await Promise.all([...activeServers].map(stopServer));
});

describe('gateway capacity mock provider', () => {
  it('returns a health response without exposing request data', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: 'Bearer do-not-log-this-token' },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      model: 'mock-sleep-1s',
    });
  });

  it('lists only the configured mock model', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/v1/models`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.object, 'list');
    assert.deepEqual(body.data.map(({ id }) => id), ['mock-sleep-1s']);
    assert.equal(body.data[0].object, 'model');
  });

  it('waits before returning an OpenAI-compatible non-streaming completion', async () => {
    const { baseUrl } = await startServer({ delayMs: 30 });
    const startedAt = performance.now();

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer do-not-log-this-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mock-sleep-1s',
        messages: [{ role: 'user', content: 'do-not-log-this-prompt' }],
        stream: false,
      }),
    });
    const elapsedMs = performance.now() - startedAt;
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.ok(elapsedMs >= 20, `expected delay, got ${elapsedMs.toFixed(1)}ms`);
    assert.match(body.id, /^chatcmpl-mock-/);
    assert.equal(body.object, 'chat.completion');
    assert.equal(body.model, 'mock-sleep-1s');
    assert.equal(body.choices[0].message.role, 'assistant');
    assert.equal(body.choices[0].finish_reason, 'stop');
    assert.ok(body.choices[0].message.content.length > 0);
    assert.deepEqual(Object.keys(body.usage).sort(), [
      'completion_tokens',
      'prompt_tokens',
      'total_tokens',
    ]);
    assert.ok(body.usage.total_tokens >= body.usage.prompt_tokens);
  });

  it('returns multiple delayed SSE chunks followed by [DONE]', async () => {
    const { baseUrl } = await startServer({ ttftMs: 25, chunkIntervalMs: 8, chunkCount: 3 });
    const startedAt = performance.now();

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-sleep-1s',
        messages: [{ role: 'user', content: 'stream prompt' }],
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/event-stream/);
    const reader = response.body.getReader();
    const firstRead = await reader.read();
    const firstChunkElapsedMs = performance.now() - startedAt;
    const chunks = [firstRead.value];
    while (!firstRead.done) {
      const next = await reader.read();
      if (next.value) chunks.push(next.value);
      if (next.done) break;
    }

    const text = new TextDecoder().decode(
      chunks.reduce((all, chunk) => {
        const merged = new Uint8Array(all.length + chunk.length);
        merged.set(all);
        merged.set(chunk, all.length);
        return merged;
      }, new Uint8Array()),
    );
    const events = text
      .split('\n\n')
      .map((event) => event.replace(/^data: /, '').trim())
      .filter(Boolean);

    assert.ok(firstChunkElapsedMs >= 15, `expected TTFT, got ${firstChunkElapsedMs.toFixed(1)}ms`);
    assert.equal(events.at(-1), '[DONE]');
    const payloads = events.slice(0, -1).map((event) => JSON.parse(event));
    assert.equal(payloads.length, 3);
    assert.ok(payloads.every((payload) => payload.object === 'chat.completion.chunk'));
    assert.ok(payloads.every((payload) => payload.choices[0].delta.content));
    assert.equal(payloads.at(-1).choices[0].finish_reason, 'stop');
  });

  it('rejects malformed or incomplete chat requests with 400', async () => {
    const { baseUrl } = await startServer();
    const endpoint = `${baseUrl}/v1/chat/completions`;

    const malformed = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    const missingMessages = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mock-sleep-1s' }),
    });

    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.type, 'invalid_request_error');
    assert.equal(missingMessages.status, 400);
    assert.equal((await missingMessages.json()).error.type, 'invalid_request_error');
  });

  it('returns 413 when the request body exceeds the configured limit', async () => {
    const { baseUrl } = await startServer({ maxBodyBytes: 1024 });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-sleep-1s',
        messages: [{ role: 'user', content: 'x'.repeat(2048) }],
      }),
    });

    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.type, 'invalid_request_error');
  });

  it('returns 404 for unknown routes', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/not-a-route`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.type, 'not_found_error');
  });

  it('bounds environment-controlled timing and concurrency settings', () => {
    const server = createMockServer({
      env: {
        MOCK_MODEL: 'gateway-capacity-model',
        MOCK_DELAY_MS: '-1',
        MOCK_TTFT_MS: 'not-a-number',
        MOCK_CHUNK_INTERVAL_MS: '999999',
        MOCK_CHUNK_COUNT: '999999',
        MOCK_PORT: '0',
      },
      logger: () => {},
    });

    assert.equal(server.mockConfig.model, 'gateway-capacity-model');
    assert.equal(server.mockConfig.delayMs, 1000);
    assert.equal(server.mockConfig.ttftMs, 100);
    assert.equal(server.mockConfig.chunkIntervalMs, 10000);
    assert.equal(server.mockConfig.chunkCount, 32);
    assert.equal(server.mockConfig.port, 8080);
    server.close();
  });

  it('does not log authorization headers or prompt content', async () => {
    const logs = [];
    const { baseUrl } = await startServer({ logger: (entry) => logs.push(entry) });
    const authorization = 'Bearer do-not-log-this-token';
    const prompt = 'do-not-log-this-prompt';

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mock-sleep-1s',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    await response.arrayBuffer();

    const serializedLogs = JSON.stringify(logs);
    assert.doesNotMatch(serializedLogs, new RegExp(authorization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(serializedLogs, new RegExp(prompt));
  });

  it('does not emit per-request logs by default when no logger is configured', async () => {
    const logs = [];
    const { baseUrl } = await startServer({ logger: (entry) => logs.push(entry), logRequests: false });

    await fetch(`${baseUrl}/health`);

    assert.deepEqual(logs, []);
  });

  it('enables structured per-request logs only when explicitly configured', async () => {
    const logs = [];
    const { baseUrl } = await startServer({
      env: { MOCK_LOG_REQUESTS: 'true' },
      logger: (entry) => logs.push(entry),
    });

    await fetch(`${baseUrl}/health`);

    assert.equal(logs.length, 1);
    assert.equal(logs[0].event, 'request');
    assert.equal(logs[0].route, 'health');
  });

  it('cancels a non-streaming delay as soon as the client aborts', async () => {
    const logs = [];
    let resolveCancelled;
    const cancelled = new Promise((resolvePromise) => {
      resolveCancelled = resolvePromise;
    });
    const { baseUrl } = await startServer({
      delayMs: 1000,
      logRequests: true,
      logger: (entry) => {
        logs.push(entry);
        if (entry.cancelled) resolveCancelled(entry);
      },
    });

    await abortHttpRequest(`${baseUrl}/v1/chat/completions`, {
      model: 'mock-sleep-1s',
      messages: [{ role: 'user', content: 'cancel this request' }],
    });
    const cancellation = await raceWithTimeout(cancelled, 500);

    assert.equal(cancellation.cancelled, true);
    assert.equal(cancellation.status, 499);
    assert.ok(logs.every((entry) => entry.status !== 200));
  });

  it('cancels a streaming TTFT delay when the response closes', async () => {
    let resolveCancelled;
    const cancelled = new Promise((resolvePromise) => {
      resolveCancelled = resolvePromise;
    });
    const { baseUrl } = await startServer({
      ttftMs: 1000,
      logRequests: true,
      logger: (entry) => {
        if (entry.cancelled) resolveCancelled(entry);
      },
    });

    const startedAt = performance.now();
    await closeStreamingResponse(`${baseUrl}/v1/chat/completions`, {
      model: 'mock-sleep-1s',
      messages: [{ role: 'user', content: 'close this stream' }],
      stream: true,
    });
    const cancellation = await raceWithTimeout(cancelled, 500);

    assert.equal(cancellation.cancelled, true);
    assert.equal(cancellation.status, 499);
    assert.ok(performance.now() - startedAt < 500, 'response close should cancel TTFT without waiting 1s');
  });
});

function raceWithTimeout(promise, milliseconds) {
  let timer;
  const timeoutPromise = new Promise((resolvePromise) => {
    timer = setTimeout(() => resolvePromise({ timedOut: true }), milliseconds);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function abortHttpRequest(url, body) {
  return new Promise((resolvePromise) => {
    const request = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    request.on('error', () => resolvePromise());
    request.on('finish', () => setImmediate(() => request.destroy()));
    request.end(JSON.stringify(body));
  });
}

function closeStreamingResponse(url, body) {
  return new Promise((resolvePromise) => {
    const request = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    request.on('response', (response) => {
      response.destroy();
      resolvePromise();
    });
    request.on('error', () => resolvePromise());
    request.end(JSON.stringify(body));
  });
}
