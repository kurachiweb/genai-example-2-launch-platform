import { z } from 'zod';

import { isValidSearchTargetName } from '../../search/search-target.ts';
import {
  defineMessageContract,
  type MessageContract,
} from '../message-contract.ts';
import type { RetryPolicy } from '../retry-policy.ts';

export interface SearchIndexRefreshBody {
  readonly target: string;
  readonly sourceId: string;
}

export const MAX_SEARCH_SOURCE_ID_LENGTH = 64;

// 受信側が処理の時点の元データを読み直すため、本文には元データの内容を含めず識別子だけを持たせる
const searchIndexRefreshBodySchema = z.object({
  target: z.string().refine(isValidSearchTargetName),
  sourceId: z.string().min(1).max(MAX_SEARCH_SOURCE_ID_LENGTH),
});

export const SEARCH_INDEX_REFRESH_MESSAGE: MessageContract<
  'search-index.refresh',
  SearchIndexRefreshBody
> = defineMessageContract('search-index.refresh', searchIndexRefreshBodySchema);

// 既定値が変わっても外部APIへの再試行の間隔が変わらないよう、既定値と同じ値を明示する
export const SEARCH_INDEX_REFRESH_RETRY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 30,
  maxDelaySeconds: 3600,
});
