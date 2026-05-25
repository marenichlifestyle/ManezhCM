import { sleep } from './sleep';

export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const RETRY_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'QUERY_LIMIT_EXCEEDED',
  'OPERATION_TIME_LIMIT',
  'OVERLOAD_LIMIT',
  'INTERNAL_SERVER_ERROR',
  'ERROR_UNEXPECTED_ANSWER'
]);

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 4;
  const minDelayMs = options.minDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const factor = options.factor ?? 2;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }

      const exponentialDelay = Math.min(maxDelayMs, minDelayMs * Math.pow(factor, attempt));
      const jitter = Math.floor(Math.random() * Math.min(250, exponentialDelay));
      const delayMs = exponentialDelay + jitter;
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
      attempt += 1;
    }
  }

  throw lastError;
}

export function defaultShouldRetry(error: unknown): boolean {
  const candidate = error as {
    status?: number;
    statusCode?: number;
    code?: string | number;
    response?: { status?: number; data?: { error?: string | number } };
  };

  const status = candidate.response?.status ?? candidate.status ?? candidate.statusCode;
  if (typeof status === 'number' && RETRY_HTTP_STATUSES.has(status)) {
    return true;
  }

  const code = String(candidate.response?.data?.error ?? candidate.code ?? '');
  return RETRY_ERROR_CODES.has(code);
}
