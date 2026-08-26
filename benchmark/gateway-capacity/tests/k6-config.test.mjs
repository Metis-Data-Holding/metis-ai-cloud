import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const common = readFileSync(new URL('../k6/common.js', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('../k6/smoke.js', import.meta.url), 'utf8');
const nonStream = readFileSync(new URL('../k6/non-stream.js', import.meta.url), 'utf8');
const streaming = readFileSync(new URL('../k6/streaming.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../run-k6.sh', import.meta.url), 'utf8');

describe('gateway capacity k6 configuration', () => {
  it('uses the four Mock Provider configuration variable names consistently', () => {
    for (const variable of ['MOCK_DELAY_MS', 'MOCK_TTFT_MS', 'MOCK_CHUNK_INTERVAL_MS', 'MOCK_CHUNK_COUNT']) {
      assert.match(runner, new RegExp(`\\b${variable}\\b`));
      assert.match(common, new RegExp(`__ENV\\.${variable}`));
    }
    assert.doesNotMatch(runner, /GATEWAY_CAPACITY_MOCK_/);
    assert.doesNotMatch(common, /GATEWAY_CAPACITY_MOCK_/);
  });

  it('uses aborting object thresholds for formal load modes', () => {
    assert.match(common, /export const loadThresholds\s*=\s*\{/);
    const loadThresholds = common.slice(common.indexOf('export const loadThresholds'));
    for (const metric of ['http_req_failed', 'gateway_error_rate', 'gateway_protocol_valid']) {
      assert.match(loadThresholds, new RegExp(`${metric}[\\s\\S]{0,240}abortOnFail:\\s*true`));
      assert.match(loadThresholds, new RegExp(`${metric}[\\s\\S]{0,240}delayAbortEval:\\s*['"]10s['"]`));
    }
  });

  it('increments exactly one status bucket per response', () => {
    assert.doesNotMatch(common, /for \(const counter of counters\)/);
    assert.doesNotMatch(common, /counter\.add\(counter === matchingCounter/);
    assert.match(common, /gatewayStatus2xx\.add\(1\)/);
    assert.match(common, /gatewayStatusTransportError\.add\(1\)/);
  });

  it('runs one non-stream and one streaming request in the single smoke iteration', () => {
    assert.match(smoke, /iterations:\s*1/);
    assert.match(smoke, /postCompletion\(false,\s*'smoke'\)/);
    assert.match(smoke, /postCompletion\(true,\s*'smoke'\)/);
  });

  it('keeps formal latency stop lines on the mode that produces each sample', () => {
    assert.match(common, /export const nonStreamLoadThresholds\s*=\s*\{/);
    assert.match(common, /export const streamingLoadThresholds\s*=\s*\{/);
    const nonStreamThresholds = common.slice(common.indexOf('export const nonStreamLoadThresholds'));
    const streamingThresholds = common.slice(common.indexOf('export const streamingLoadThresholds'));
    assert.match(nonStreamThresholds, /gateway_overhead_duration_ms[\s\S]{0,240}p\(95\)<1000[\s\S]{0,120}abortOnFail:\s*true[\s\S]{0,120}delayAbortEval:\s*['"]10s['"]/);
    assert.match(streamingThresholds, /gateway_http_ttfb[\s\S]{0,240}p\(95\)<1000[\s\S]{0,120}abortOnFail:\s*true[\s\S]{0,120}delayAbortEval:\s*['"]10s['"]/);
    assert.match(nonStream, /nonStreamLoadThresholds/);
    assert.match(streaming, /streamingLoadThresholds/);
    assert.doesNotMatch(nonStream, /streamingLoadThresholds/);
    assert.doesNotMatch(streaming, /nonStreamLoadThresholds/);
    assert.match(common, /HTTP 响应头首字节.*不是严格的模型 TTFT/);
  });

  it('selects the streaming Accept header from the stream boolean', () => {
    assert.match(common, /export function requestParams\(stream, mode\)/);
    assert.match(common, /Accept:\s*stream\s*\?\s*['"]text\/event-stream['"]\s*:\s*['"]application\/json['"]/);
    assert.match(common, /tags:\s*\{\s*gateway_test_mode:\s*mode/);
    assert.match(common, /requestParams\(stream, mode\)/);
  });
});
