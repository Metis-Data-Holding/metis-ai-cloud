function parseJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstChoice(value) {
  return isRecord(value) && Array.isArray(value.choices) ? value.choices[0] : null;
}

export function validateNonStreamResponse(payload, expectedModel, sentinel = 'Mock response after') {
  const body = parseJson(payload);
  const choice = firstChoice(body);
  const message = isRecord(choice) ? choice.message : null;
  const content = isRecord(message) ? message.content : null;

  return (
    typeof expectedModel === 'string' &&
    expectedModel.length > 0 &&
    isRecord(body) &&
    body.object === 'chat.completion' &&
    body.model === expectedModel &&
    isRecord(message) &&
    message.role === 'assistant' &&
    typeof content === 'string' &&
    content.includes(sentinel)
  );
}

export function validateStreamingResponse(body, expectedModel, sentinel = 'mock chunk') {
  if (typeof expectedModel !== 'string' || expectedModel.length === 0 || typeof body !== 'string') return false;

  let done = false;
  let chunkCount = 0;
  let sentinelFound = false;
  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    if (done) return false;

    const data = line.slice('data:'.length).trim();
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    if (!data) return false;

    const chunk = parseJson(data);
    const choice = firstChoice(chunk);
    const delta = isRecord(choice) ? choice.delta : null;
    const content = isRecord(delta) ? delta.content : null;
    if (!isRecord(chunk) || chunk.object !== 'chat.completion.chunk' || chunk.model !== expectedModel) return false;
    if (!isRecord(delta) || typeof content !== 'string') return false;

    chunkCount += 1;
    if (content.includes(sentinel)) sentinelFound = true;
  }

  return done && chunkCount > 0 && sentinelFound;
}
