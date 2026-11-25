import type { CounterRule } from '../../../lib/core/rate-limit/fixed-window.ts';
import type { ApiAccess } from '../../domain/public-api/api-key-scopes.ts';

export const API_KEY_ISSUE_RULE = Object.freeze({
  name: 'api-key-issue-by-user',
  limit: 3,
  windowSeconds: 3600,
} as const satisfies CounterRule);

export const PUBLIC_API_READ_RULE = Object.freeze({
  name: 'public-api-read-by-user',
  limit: 30,
  windowSeconds: 60,
} as const satisfies CounterRule);

export const PUBLIC_API_WRITE_RULE = Object.freeze({
  name: 'public-api-write-by-user',
  limit: 15,
  windowSeconds: 60,
} as const satisfies CounterRule);

export const ruleForAccess = (access: ApiAccess): CounterRule =>
  access === 'write' ? PUBLIC_API_WRITE_RULE : PUBLIC_API_READ_RULE;

// 上限と期間はWrangler設定のPUBLIC_API_RATE_LIMITERが決めるため、この値は仕様書の説明と超過の応答のRetry-Afterに使う写しで、設定の検査のテストで一致を確かめる
export const PUBLIC_API_IP_RATE_LIMIT = Object.freeze({
  limit: 60,
  periodSeconds: 60,
} as const);
