import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateNonStreamResponse, validateStreamingResponse } from '../k6/validators.js';

const model = 'mock-sleep-1s';

describe('gateway capacity response source validators', () => {
  it('accepts a non-stream response from the configured Mock Provider', () => {
    assert.equal(
      validateNonStreamResponse(
        {
          object: 'chat.completion',
          model,
          choices: [{ message: { role: 'assistant', content: 'Mock response after 1000ms.' } }],
        },
        model,
      ),
      true,
    );
  });

  it('rejects an otherwise OpenAI-compatible response from a non-Mock source', () => {
    assert.equal(
      validateNonStreamResponse(
        {
          object: 'chat.completion',
          model,
          choices: [{ message: { role: 'assistant', content: 'A real provider response.' } }],
        },
        model,
      ),
      false,
    );
  });

  it('rejects a non-stream response whose model differs from the requested model', () => {
    assert.equal(
      validateNonStreamResponse(
        {
          object: 'chat.completion',
          model: 'another-model',
          choices: [{ message: { role: 'assistant', content: 'Mock response after 1000ms.' } }],
        },
        model,
      ),
      false,
    );
  });

  it('accepts every matching streaming chunk followed by the final DONE event', () => {
    const body = [
      'data: {"object":"chat.completion.chunk","model":"mock-sleep-1s","choices":[{"delta":{"content":"mock chunk 1"}}]}',
      '',
      'data: {"object":"chat.completion.chunk","model":"mock-sleep-1s","choices":[{"delta":{"content":"mock chunk 2"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    assert.equal(validateStreamingResponse(body, model), true);
  });

  it('rejects a stream when any JSON chunk comes from a different model', () => {
    const body = [
      'data: {"object":"chat.completion.chunk","model":"mock-sleep-1s","choices":[{"delta":{"content":"mock chunk 1"}}]}',
      '',
      'data: {"object":"chat.completion.chunk","model":"another-model","choices":[{"delta":{"content":"mock chunk 2"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    assert.equal(validateStreamingResponse(body, model), false);
  });

  it('rejects a stream without a final DONE event or Mock chunk sentinel', () => {
    const body = 'data: {"object":"chat.completion.chunk","model":"mock-sleep-1s","choices":[{"delta":{"content":"provider chunk"}}]}\n\n';

    assert.equal(validateStreamingResponse(body, model), false);
  });
});
