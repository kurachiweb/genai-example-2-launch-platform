import { z } from 'zod';

// 秘密鍵(sk_)を誤って登録しても受け付けないよう、権限を絞った制限付きキーの形だけを受け付ける
const STRIPE_RESTRICTED_KEY_PATTERN = /^rk_(?:test|live)_[A-Za-z0-9]+$/;

const STRIPE_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]+$/;

// 未登録のローカルとCIでも起動し、決済の機能だけを縮退させるため、キーと署名の秘密は任意にする
export const paymentsApiEnvShape = {
  STRIPE_API_KEY: z.string().regex(STRIPE_RESTRICTED_KEY_PATTERN).optional(),
  PAYMENTS_SMOKE_ENABLED: z.enum(['true', 'false']),
} satisfies z.ZodRawShape;

export const paymentsEventEnvShape = {
  ...paymentsApiEnvShape,
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(STRIPE_WEBHOOK_SECRET_PATTERN)
    .optional(),
} satisfies z.ZodRawShape;
