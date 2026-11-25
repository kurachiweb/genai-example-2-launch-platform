import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import {
  type TransientRetryOptions,
  withTransientRetry,
} from './transient-retry.ts';

export type Database = DrizzleD1Database;

export function createDatabase(
  d1: D1Database,
  options: TransientRetryOptions = {},
): Database {
  return drizzle(withTransientRetry(d1, options));
}
