import type { Config } from './config';
import type { Db } from './db';

export interface Deps {
  db: Db;
  config: Config;
  clock: () => Date;
}

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
    public code: string,
    message?: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message ?? code);
  }
}

export const KINDS = ['attendance', 'visitor', 'event', 'asset', 'task'] as const;
export type Kind = (typeof KINDS)[number];
