import { z } from 'zod';

import { isValidEmailAddress } from '../../lib/core/email/email-address.ts';
import {
  APP_ENVIRONMENTS,
  type AppEnvironment,
  isDeployedEnvironmentValue,
} from '../../lib/core/env/app-environment.ts';
import { isHttpOrigin } from '../../lib/core/env/http-origin.ts';
import type { DeadLetterNotice } from '../../lib/core/messaging/envelope.ts';
import { paymentsEventEnvShape } from '../../lib/core/payments/payments-env.ts';
import {
  bindingSchema,
  platformEnvShape,
} from '../../lib/workers/env/platform-env.ts';
import type { QueueConsumerEnv } from '../../lib/workers/messaging/queue-consumer.ts';
import type { SendEmailBindingLike } from '../infrastructure/email/providers/cloudflare-email-provider.ts';
import type { EventEmailEnv } from '../infrastructure/email/providers/create-email-provider.ts';
import type { EventKeywordExtractorEnv } from '../infrastructure/search/create-keyword-extractor.ts';
import {
  type EventMediaEnv,
  type MediaConditionalKey,
  mediaEnvShape,
  requiredMediaConditionalKeys,
} from './media-env.ts';

export interface EventPlatformEnv
  extends
    QueueConsumerEnv,
    EventEmailEnv,
    EventKeywordExtractorEnv,
    EventMediaEnv {
  readonly IMAGES: ImagesBinding;
  readonly EMAIL_FROM_ADDRESS: string;
  readonly EMAIL_EVENTS_QUEUE_NAME: string;
  readonly APP_ENVIRONMENT: AppEnvironment;
  // ローカル環境だけ省略できる。空文字は未設定として扱う
  readonly DISIFY_API_KEY?: string;
  readonly CLIENT_SITE_ORIGIN: string;
  // 未登録のローカルとCIでも起動できるよう任意にする。未設定なら決済の機能だけが縮退する
  readonly STRIPE_API_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly PAYMENTS_SMOKE_ENABLED: 'true' | 'false';
}

type ConditionalKey =
  | 'MAILPIT_API_URL'
  | 'EMAIL'
  | 'EMAIL_ALLOWED_RECIPIENTS'
  | 'GOOGLE_NL_API_KEY'
  | 'DISIFY_API_KEY'
  | MediaConditionalKey;

// 送信プロバイダ・宛先の制限の方針・キーワード抽出の実装・判定サービスの実装・環境の種別ごとに、動作に欠かせない設定のキー
function requiredConditionalKeys(
  env: Pick<
    EventPlatformEnv,
    | 'EMAIL_PROVIDER'
    | 'EMAIL_RECIPIENT_POLICY'
    | 'KEYWORD_EXTRACTOR'
    | 'MODERATION_PROVIDER'
    | 'APP_ENVIRONMENT'
  >,
): readonly ConditionalKey[] {
  return [
    ...(env.EMAIL_PROVIDER === 'mailpit' ? (['MAILPIT_API_URL'] as const) : []),
    ...(env.EMAIL_PROVIDER === 'cloudflare' ? (['EMAIL'] as const) : []),
    ...(env.EMAIL_RECIPIENT_POLICY === 'allowlist'
      ? (['EMAIL_ALLOWED_RECIPIENTS'] as const)
      : []),
    ...(env.KEYWORD_EXTRACTOR === 'google-natural-language'
      ? (['GOOGLE_NL_API_KEY'] as const)
      : []),
    // デプロイ先の環境でキーの登録を忘れると判定せずに通常として扱い続けるため、起動時に止める
    ...(isDeployedEnvironmentValue(env.APP_ENVIRONMENT)
      ? (['DISIFY_API_KEY'] as const)
      : []),
    ...requiredMediaConditionalKeys(env),
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
    APP_ENVIRONMENT: z.enum(APP_ENVIRONMENTS),
    MAILPIT_API_URL: z.url({ protocol: /^https?$/u }).optional(),
    EMAIL: bindingSchema<SendEmailBindingLike>().optional(),
    EMAIL_ALLOWED_RECIPIENTS: z.string().min(1).optional(),
    KEYWORD_EXTRACTOR: z.enum(['google-natural-language', 'disabled']),
    GOOGLE_NL_API_KEY: z.string().min(1).optional(),
    DISIFY_API_KEY: z.string().optional(),
    CLIENT_SITE_ORIGIN: z.string().refine(isHttpOrigin),
    ...mediaEnvShape,
    ...paymentsEventEnvShape,
  })
  // 他のキーに不備があっても条件付きの必須キーの欠落を一緒に報告するよう、環境がオブジェクトなら検査する。問題の経路にキーを入れ、欠けたキーとして分類させる
  .check(
    z.superRefine(
      (env, context) => {
        for (const key of requiredConditionalKeys(env)) {
          if (env[key] === undefined || env[key] === '') {
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

type PaymentsSecretKey = 'STRIPE_API_KEY' | 'STRIPE_WEBHOOK_SECRET';

// wrangler typesはsecrets.requiredのキーを常にある型にするが、Stripeのキーは未登録のローカルとCIでは渡らないため任意の型に戻す
export type EventEnv = SatisfiesEventPlatformEnv<
  Omit<Env, PaymentsSecretKey> & Pick<EventPlatformEnv, PaymentsSecretKey>
>;
