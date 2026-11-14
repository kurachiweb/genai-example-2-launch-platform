import { z } from 'zod';

import {
  defineMessageContract,
  type MessageContract,
} from '../messaging/message-contract.ts';
import type { RetryPolicy } from '../messaging/retry-policy.ts';

export interface RunActivationHandlersBody {
  readonly activationId: string;
}

// 利用者や定期課金の情報は受信側が知らせの行から読み直すため、本文には知らせのIDだけを持たせる
const runActivationHandlersBodySchema = z.object({
  activationId: z.ulid(),
});

export const ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE: MessageContract<
  'ultras.run-activation-handlers',
  RunActivationHandlersBody
> = defineMessageContract(
  'ultras.run-activation-handlers',
  runActivationHandlersBodySchema,
);

// 処理はStripeを呼び得るため、既定値より長い60秒から倍にして再試行する
export const ULTRAS_ACTIVATION_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 60,
  maxDelaySeconds: 3600,
});
