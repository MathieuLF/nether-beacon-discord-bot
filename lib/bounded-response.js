const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

class ResponseTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Response exceeds ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
    this.code = 'RESPONSE_TOO_LARGE';
    this.maxBytes = maxBytes;
  }
}

const normalizeMaxBytes = (value, fallback = DEFAULT_MAX_RESPONSE_BYTES) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const responseHeader = (response, name) => {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name);
  return response?.headers?.[name] ?? response?.headers?.[name.toLowerCase()] ?? null;
};

const assertDeclaredLength = (response, maxBytes) => {
  const declared = Number.parseInt(String(responseHeader(response, 'content-length') || ''), 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ResponseTooLargeError(maxBytes);
  }
  return Number.isFinite(declared) && declared >= 0 ? declared : null;
};

const readResponseText = async (response, { maxBytes = DEFAULT_MAX_RESPONSE_BYTES } = {}) => {
  const limit = normalizeMaxBytes(maxBytes);
  const declaredLength = assertDeclaredLength(response, limit);

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        received += chunk.length;
        if (received > limit) {
          await reader.cancel().catch(() => undefined);
          throw new ResponseTooLargeError(limit);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }

    return Buffer.concat(chunks, received).toString('utf8');
  }

  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let received = 0;
    for await (const value of response.body) {
      const chunk = Buffer.from(value);
      received += chunk.length;
      if (received > limit) {
        response.body.destroy?.();
        throw new ResponseTooLargeError(limit);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, received).toString('utf8');
  }

  if (declaredLength === 0) return '';
  throw new TypeError('A streaming response body is required');
};

const readJsonResponse = async (response, options = {}) => {
  const text = await readResponseText(response, options);
  return text ? JSON.parse(text) : null;
};

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
  normalizeMaxBytes,
  readJsonResponse,
  readResponseText,
};
