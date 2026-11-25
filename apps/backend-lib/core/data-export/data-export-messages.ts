import { z } from 'zod';

import { UPPERCASE_ULID_PATTERN } from '../ids/uppercase-ulid.ts';
import {
  defineMessageContract,
  type MessageContract,
} from '../messaging/message-contract.ts';
import type { RetryPolicy } from '../messaging/retry-policy.ts';

export interface DataExportMessageBody {
  readonly exportId: string;
}

// デッドレターや再試行で本文が運ばれ続けるため、メールアドレスや利用者のIDを入れず、受信側が記録を読み直す要求のIDだけを持たせる
const dataExportMessageBodySchema = z.object({
  exportId: z.ulid().regex(UPPERCASE_ULID_PATTERN),
});

export const DATA_EXPORT_GENERATE_MESSAGE: MessageContract<
  'data-export.generate-archive',
  DataExportMessageBody
> = defineMessageContract(
  'data-export.generate-archive',
  dataExportMessageBodySchema,
);

export const DATA_EXPORT_WATCHDOG_MESSAGE: MessageContract<
  'data-export.check-generation',
  DataExportMessageBody
> = defineMessageContract(
  'data-export.check-generation',
  dataExportMessageBodySchema,
);

export const GENERATION_WATCHDOG_DELAY_SECONDS = 7200;

// 見張りのメッセージを失った要求を日次の受け皿が拾う閾値で、見張りの遅延より後にして二重に失敗へ移さない
export const GENERATION_STALL_SECONDS = 10_800;

export const GENERATION_LEASE_SECONDS = 1200;

export const GENERATION_MAX_ATTEMPTS = 3;

export const GENERATION_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: GENERATION_MAX_ATTEMPTS,
  baseDelaySeconds: 60,
  maxDelaySeconds: 600,
});

export const BUSY_DEFER_SECONDS = 1200;
