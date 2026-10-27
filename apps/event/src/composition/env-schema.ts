import { z } from 'zod';

import { isValidEmailAddress } from '../../lib/core/email/email-address.ts';
import type { DeadLetterNotice } from '../../lib/core/messaging/envelope.ts';
import {
  bindingSchema,
  platformEnvShape,
} from '../../lib/workers/env/platform-env.ts';
import type { QueueConsumerEnv } from '../../lib/workers/messaging/queue-consumer.ts';
import type { SendEmailBindingLike } from '../infrastructure/email/providers/cloudflare-email-provider.ts';
import type { EventEmailEnv } from '../infrastructure/email/providers/create-email-provider.ts';

export interface EventPlatformEnv extends QueueConsumerEnv, EventEmailEnv {
  readonly IMAGES: ImagesBinding;
  readonly EMAIL_FROM_ADDRESS: string;
  readonly EMAIL_EVENTS_QUEUE_NAME: string;
}

type ConditionalKey = 'MAILPIT_API_URL' | 'EMAIL' | 'EMAIL_ALLOWED_RECIPIENTS';

// 送信プロバイダと宛先の制限の方針ごとに、送信に欠かせない設定のキー
function requiredConditionalKeys(
  env: Pick<EventPlatformEnv, 'EMAIL_PROVIDER' | 'EMAIL_RECIPIENT_POLICY'>,
): readonly ConditionalKey[] {
  return [
    ...(env.EMAIL_PROVIDER === 'mailpit' ? (['MAILPIT_API_URL'] as const) : []),
    ...(env.EMAIL_PROVIDER === 'cloudflare' ? (['EMAIL'] as const) : []),
    ...(env.EMAIL_RECIPIENT_POLICY === 'allowlist'
      ? (['EMAIL_ALLOWED_RECIPIENTS'] as const)
      : []),
  ];
}

export const eventEnvSchema = z
  .object({
    ...platformEnvShape,
    JOBS_DLQ: bindingSchema<Queue<DeadLetterNotice>>(),
    IMAGES: bindingSchema<ImagesBinding>(),
    JOBS_QUEUE_NAME: z.string().min(1),
    JOBS_DLQ_NAME: z.string().min(1),
    EMAIL_PROVIDER: z.enum(['mailpit', 'cloudflare']),
    EMAIL_FROM_ADDRESS: z.string().refine(isValidEmailAddress),
    EMAIL_RECIPIENT_POLICY: z.enum(['any', 'allowlist']),
    EMAIL_EVENTS_QUEUE_NAME: z.string().min(1),
    MAILPIT_API_URL: z.url({ protocol: /^https?$/u }).optional(),
    EMAIL: bindingSchema<SendEmailBindingLike>().optional(),
    EMAIL_ALLOWED_RECIPIENTS: z.string().min(1).optional(),
  })
  // 他のキーに不備があっても条件付きの必須キーの欠落を一緒に報告するよう、環境がオブジェクトなら検査する。問題の経路にキーを入れ、欠けたキーとして分類させる
  .check(
    z.superRefine(
      (env, context) => {
        for (const key of requiredConditionalKeys(env)) {
          if (env[key] === undefined) {
            context.addIssue({ code: 'custom', path: [key], input: undefined });
          }
        }
      },
      {
        when: ({ value }) => typeof value === 'object' && value !== null,
      },
    ),
  ) satisfies z.ZodType<EventPlatformEnv>;

// wrangler typesが生成した環境の型が、両サーバー共通の型とeventのバインディング・変数の型を満たさなければ型検査で失敗させる
type SatisfiesEventPlatformEnv<T extends EventPlatformEnv> = T;

export type EventEnv = SatisfiesEventPlatformEnv<Env>;
