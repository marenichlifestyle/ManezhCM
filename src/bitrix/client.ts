import axios, { AxiosInstance } from 'axios';
import { logger } from '../logger';
import { sleep } from '../utils/sleep';
import { withRetry } from '../utils/retry';

export interface BitrixRawResponse<T = unknown> {
  result?: T;
  next?: number;
  total?: number;
  time?: unknown;
  error?: string | number;
  error_description?: string;
}

export class BitrixApiError extends Error {
  readonly status?: number;
  readonly code?: string | number;
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; code?: string | number; details?: unknown } = {}) {
    super(message);
    this.name = 'BitrixApiError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export class BitrixClient {
  private readonly http: AxiosInstance;
  private lastRequestAt = 0;

  constructor(
    webhookBaseUrl: string,
    private readonly delayMs: number,
    private readonly maxRetries = 5
  ) {
    this.http = axios.create({
      baseURL: `${webhookBaseUrl.replace(/\/+$/, '')}/`,
      timeout: 30_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await this.callRaw<T>(method, params);
    return response.result as T;
  }

  async callRaw<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<BitrixRawResponse<T>> {
    return withRetry(
      async () => {
        await this.throttle();
        const endpoint = method.endsWith('.json') ? method : `${method}.json`;
        const response = await this.http.post<BitrixRawResponse<T>>(endpoint, params);
        const data = response.data;

        if (data.error !== undefined) {
          throw new BitrixApiError(data.error_description || String(data.error), {
            status: response.status,
            code: data.error,
            details: data
          });
        }

        return data;
      },
      {
        retries: this.maxRetries,
        onRetry: (error, attempt, delayMs) => {
          logger.warn({ error: serializeBitrixError(error), method, attempt, delayMs }, 'Retry Bitrix24 request');
        }
      }
    );
  }

  async listAll<T>(
    method: string,
    params: Record<string, unknown>,
    resultKey: string
  ): Promise<T[]> {
    const items: T[] = [];
    let start = 0;

    for (;;) {
      const response = await this.callRaw<Record<string, unknown>>(method, {
        ...params,
        start
      });

      const pageItems = extractListItems<T>(response, resultKey);
      items.push(...pageItems);

      const next = readNext(response);
      if (next === undefined) {
        break;
      }

      start = next;
    }

    return items;
  }

  private async throttle(): Promise<void> {
    if (this.delayMs <= 0) return;

    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.delayMs) {
      await sleep(this.delayMs - elapsed);
    }

    this.lastRequestAt = Date.now();
  }
}

function extractListItems<T>(response: BitrixRawResponse<Record<string, unknown>>, resultKey: string): T[] {
  const result = response.result;

  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && Array.isArray(result[resultKey])) {
    return result[resultKey] as T[];
  }

  const direct = (response as Record<string, unknown>)[resultKey];
  if (Array.isArray(direct)) {
    return direct as T[];
  }

  return [];
}

function readNext(response: BitrixRawResponse<Record<string, unknown>>): number | undefined {
  if (typeof response.next === 'number') {
    return response.next;
  }

  const nestedNext = response.result?.next;
  return typeof nestedNext === 'number' ? nestedNext : undefined;
}

function serializeBitrixError(error: unknown): Record<string, unknown> {
  if (error instanceof BitrixApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      code: error.code,
      details: error.details
    };
  }

  const candidate = error as {
    name?: string;
    message?: string;
    code?: string;
    response?: { status?: number; data?: unknown };
  };

  return {
    name: candidate.name,
    message: candidate.message,
    code: candidate.code,
    status: candidate.response?.status,
    details: candidate.response?.data
  };
}
