import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const common = readFileSync(new URL('../k6/common.js', import.meta.url), 'utf8');
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
});
