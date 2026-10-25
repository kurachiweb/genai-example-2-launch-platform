import { z } from 'zod';

import type { DeadLetterNotice } from '../../lib/core/messaging/envelope.ts';
import {
  bindingSchema,
  platformEnvShape,
} from '../../lib/workers/env/platform-env.ts';
import type { QueueConsumerEnv } from '../../lib/workers/messaging/queue-consumer.ts';

export interface EventPlatformEnv extends QueueConsumerEnv {
  readonly IMAGES: ImagesBinding;
}

export const eventEnvSchema = z.object({
  ...platformEnvShape,
  JOBS_DLQ: bindingSchema<Queue<DeadLetterNotice>>(),
  IMAGES: bindingSchema<ImagesBinding>(),
  JOBS_QUEUE_NAME: z.string().min(1),
  JOBS_DLQ_NAME: z.string().min(1),
}) satisfies z.ZodType<EventPlatformEnv>;

// wrangler typesが生成した環境の型が、両サーバー共通の型とeventのバインディング・変数の型を満たさなければ型検査で失敗させる
type SatisfiesEventPlatformEnv<T extends EventPlatformEnv> = T;

export type EventEnv = SatisfiesEventPlatformEnv<Env>;
