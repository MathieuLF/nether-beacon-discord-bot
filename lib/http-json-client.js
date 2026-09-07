const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_MS = 15000;
const DEFAULT_CIRCUIT_BREAKER_MS = 30000;
const {
  DEFAULT_MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
  normalizeMaxBytes,
  readResponseText,
} = require('./bounded-response');

class SafeHttpError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SafeHttpError';
    this.code = code;
    this.status = details.status || null;
    this.retryable = Boolean(details.retryable);
    this.circuitOpen = Boolean(details.circuitOpen);
    this.retryAt = details.retryAt || null;
    this.causeName = details.causeName || null;
  }
}

const normalizeTimeoutMs = (value, fallback = DEFAULT_TIMEOUT_MS) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeCacheTtlMs = (value, fallback = DEFAULT_CACHE_TTL_MS) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const isTransientNetworkError = (error) => {
  if (!error) return false;
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR') return false;

  const code = String(error.code || error.cause?.code || '').toUpperCase();
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_SOCKET'].includes(code)) {
    return true;
  }

  return error instanceof TypeError || /network|fetch failed|socket|connection/i.test(String(error.message || ''));
};

const createCacheKey = (url, { method, body }) =>
  `${String(method || 'GET').toUpperCase()} ${url} ${body ? JSON.stringify(body) : ''}`;

const createHttpJsonClient = ({
  fetchImpl = globalThis.fetch,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  defaultCacheTtlMs = DEFAULT_CACHE_TTL_MS,
  defaultCircuitBreakerMs = DEFAULT_CIRCUIT_BREAKER_MS,
  defaultMaxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  now = () => Date.now(),
} = {}) => {
  const cache = new Map();
  let circuitOpenUntil = 0;

  const openCircuit = (durationMs) => {
    const parsed = normalizeCacheTtlMs(durationMs, defaultCircuitBreakerMs);
    if (parsed > 0) {
      circuitOpenUntil = Math.max(circuitOpenUntil, now() + parsed);
    }
  };

  const requestJson = async (url, {
    method = 'GET',
    body = null,
    headers = {},
    timeoutMs = defaultTimeoutMs,
    cacheTtlMs = defaultCacheTtlMs,
    circuitBreakerMs = 0,
    retryTransient = true,
    maxResponseBytes = defaultMaxResponseBytes,
  } = {}) => {
    if (typeof fetchImpl !== 'function') {
      throw new SafeHttpError('FETCH_UNAVAILABLE', 'HTTP client is not available');
    }

    const normalizedMethod = String(method || 'GET').toUpperCase();
    const effectiveCacheTtlMs = normalizeCacheTtlMs(cacheTtlMs, 0);
    const cacheKey = createCacheKey(url, { method: normalizedMethod, body });
    const cached = cache.get(cacheKey);

    if (normalizedMethod === 'GET' && effectiveCacheTtlMs > 0 && cached && now() - cached.storedAt <= effectiveCacheTtlMs) {
      return cached.value;
    }

    if (circuitBreakerMs > 0 && circuitOpenUntil > now()) {
      throw new SafeHttpError('CIRCUIT_OPEN', 'Service temporarily unavailable', {
        circuitOpen: true,
        retryAt: new Date(circuitOpenUntil).toISOString(),
      });
    }

    const attempts = retryTransient && normalizedMethod === 'GET' ? 2 : 1;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), normalizeTimeoutMs(timeoutMs, defaultTimeoutMs));

      try {
        const response = await fetchImpl(url, {
          method: normalizedMethod,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });

        if (!response.ok) {
          if (circuitBreakerMs > 0 && response.status >= 500) {
            openCircuit(circuitBreakerMs);
          }
          throw new SafeHttpError('HTTP_STATUS', `HTTP ${response.status}`, { status: response.status });
        }

        if (response.status === 204) return null;

        let text;
        try {
          text = await readResponseText(response, {
            maxBytes: normalizeMaxBytes(maxResponseBytes, defaultMaxResponseBytes),
          });
        } catch (error) {
          if (error instanceof ResponseTooLargeError) {
            throw new SafeHttpError('RESPONSE_TOO_LARGE', 'HTTP response is too large');
          }
          throw error;
        }
        if (!text) return null;

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new SafeHttpError('INVALID_JSON', 'Invalid JSON response');
        }

        if (normalizedMethod === 'GET' && effectiveCacheTtlMs > 0) {
          cache.set(cacheKey, { value: parsed, storedAt: now() });
        }

        return parsed;
      } catch (error) {
        if (error instanceof SafeHttpError) throw error;

        const isTimeout = error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
        const transient = isTransientNetworkError(error);
        lastError = new SafeHttpError(isTimeout ? 'HTTP_TIMEOUT' : 'NETWORK_ERROR', isTimeout ? 'HTTP request timed out' : 'Network request failed', {
          retryable: transient,
          causeName: error?.name || null,
        });

        if (attempt < attempts && transient) {
          continue;
        }

        if (circuitBreakerMs > 0) {
          openCircuit(circuitBreakerMs);
        }
        throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError || new SafeHttpError('NETWORK_ERROR', 'Network request failed');
  };

  return {
    clearCache: () => cache.clear(),
    getCircuitState: () => ({
      open: circuitOpenUntil > now(),
      openUntil: circuitOpenUntil ? new Date(circuitOpenUntil).toISOString() : null,
    }),
    getJson: (url, options = {}) => requestJson(url, { ...options, method: 'GET' }),
    postJson: (url, body, options = {}) => requestJson(url, { ...options, method: 'POST', body }),
    requestJson,
  };
};

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CIRCUIT_BREAKER_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  SafeHttpError,
  createHttpJsonClient,
  isTransientNetworkError,
  normalizeCacheTtlMs,
  normalizeTimeoutMs,
};
