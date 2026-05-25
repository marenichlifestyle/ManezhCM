import axios, { AxiosInstance } from 'axios';
import { logger } from '../logger';
import { withRetry } from '../utils/retry';
import { RawCar } from './normalize';

export interface CmExpertConfig {
  clientId: string;
  clientSecret: string;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

export class CmExpertClient {
  private readonly http: AxiosInstance;
  private token?: TokenState;

  constructor(private readonly config: CmExpertConfig) {
    this.http = axios.create({
      baseURL: 'https://lk.cm.expert',
      timeout: 30_000,
      headers: {
        Accept: 'application/json'
      }
    });
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.accessToken;
    }

    const payload = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });

    const response = await withRetry(
      () =>
        this.http.post('/oauth/token', payload.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }),
      {
        onRetry: (error, attempt, delayMs) => {
          logger.warn({ error: serializeRetryError(error), attempt, delayMs }, 'Retry CM.Expert token request');
        }
      }
    );

    const data = response.data as Record<string, unknown>;
    const accessToken = String(data.access_token ?? data.accessToken ?? data.token ?? '').trim();
    if (!accessToken) {
      throw new Error('CM.Expert token response does not contain access_token');
    }

    const expiresIn = Number(data.expires_in ?? data.expiresIn ?? 3600);
    this.token = {
      accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
    };

    return accessToken;
  }

  async getCarsPage(page = 1, perPage = 50): Promise<{ raw: unknown; cars: RawCar[] }> {
    const accessToken = await this.getAccessToken();

    const response = await withRetry(
      () =>
        this.http.get('/api/v1/dealers/dms/cars', {
          params: { page, perPage },
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }),
      {
        onRetry: (error, attempt, delayMs) => {
          logger.warn({ error: serializeRetryError(error), attempt, delayMs, page }, 'Retry CM.Expert cars request');
        }
      }
    );

    return {
      raw: response.data,
      cars: extractCarsFromResponse(response.data)
    };
  }

  async getAllCars(perPage = 50): Promise<RawCar[]> {
    const cars: RawCar[] = [];

    for (let page = 1; page <= 1000; page += 1) {
      const pageResult = await this.getCarsPage(page, perPage);
      cars.push(...pageResult.cars);

      logger.info({ page, pageCount: pageResult.cars.length, totalReceived: cars.length }, 'Fetched CM.Expert cars page');

      if (!shouldFetchNextPage(pageResult.raw, pageResult.cars.length, page, perPage)) {
        break;
      }
    }

    return cars;
  }
}

export function extractCarsFromResponse(raw: unknown): RawCar[] {
  const candidates = [
    raw,
    getObjectValue(raw, 'data'),
    getObjectValue(raw, 'items'),
    getObjectValue(raw, 'cars'),
    getObjectValue(raw, 'content'),
    getObjectValue(getObjectValue(raw, 'result'), 'data'),
    getObjectValue(getObjectValue(raw, 'result'), 'items'),
    getObjectValue(getObjectValue(raw, 'result'), 'cars')
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord) as RawCar[];
    }
  }

  return [];
}

function shouldFetchNextPage(raw: unknown, pageCount: number, page: number, perPage: number): boolean {
  if (pageCount === 0) return false;

  const totalPages = readNumber(raw, ['totalPages', 'pages', 'lastPage', 'pageCount']);
  if (totalPages !== undefined) {
    return page < totalPages;
  }

  const total = readNumber(raw, ['total', 'totalCount', 'count']);
  if (total !== undefined) {
    return page * perPage < total;
  }

  const hasNext = readBoolean(raw, ['hasNext', 'hasNextPage']);
  if (hasNext !== undefined) {
    return hasNext;
  }

  return pageCount >= perPage;
}

function getObjectValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown, keys: string[]): number | undefined {
  if (!isRecord(value)) return undefined;

  for (const key of keys) {
    const direct = Number(value[key]);
    if (Number.isFinite(direct)) return direct;
  }

  for (const nestedKey of ['meta', 'pagination', 'page']) {
    const nested = value[nestedKey];
    if (!isRecord(nested)) continue;
    for (const key of keys) {
      const nestedValue = Number(nested[key]);
      if (Number.isFinite(nestedValue)) return nestedValue;
    }
  }

  return undefined;
}

function readBoolean(value: unknown, keys: string[]): boolean | undefined {
  if (!isRecord(value)) return undefined;

  for (const key of keys) {
    if (typeof value[key] === 'boolean') return value[key];
  }

  for (const nestedKey of ['meta', 'pagination', 'page']) {
    const nested = value[nestedKey];
    if (!isRecord(nested)) continue;
    for (const key of keys) {
      if (typeof nested[key] === 'boolean') return nested[key];
    }
  }

  return undefined;
}

function serializeRetryError(error: unknown): Record<string, unknown> {
  const candidate = error as {
    message?: string;
    code?: string;
    response?: { status?: number; data?: unknown };
  };

  return {
    message: candidate.message,
    code: candidate.code,
    status: candidate.response?.status,
    response: candidate.response?.data
  };
}
