import { z } from 'zod';

import {
  type ModerationConfigVars,
  parseBlockedCategories,
  parseMinConfidence,
} from '../application/media/moderation-config.ts';
import {
  type EventModerationProviderEnv,
  MODERATION_REGION_PATTERN,
} from '../infrastructure/media/create-moderation-provider.ts';
import type { MediaSmokeEnv } from '../presentation/media/media-smoke-routes.ts';

export interface EventMediaEnv
  extends EventModerationProviderEnv, ModerationConfigVars, MediaSmokeEnv {
  readonly IMAGE_DELIVERY_HOSTNAME: string;
  readonly IMAGE_DELIVERY_DEDICATED_HOST: 'true' | 'false';
}

export type MediaConditionalKey =
  'REKOGNITION_ACCESS_KEY_ID' | 'REKOGNITION_SECRET_ACCESS_KEY';

// 要求のURLのホスト名と比べるため、スキームやポートを含まないホスト名の形だけを受け付ける
const HOSTNAME_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/iu;

const REKOGNITION_CREDENTIAL_KEYS: readonly MediaConditionalKey[] =
  Object.freeze(['REKOGNITION_ACCESS_KEY_ID', 'REKOGNITION_SECRET_ACCESS_KEY']);

// 判定の設定の誤りで判定の処理が毎回失敗し続けないよう、処理の始まる前に判定の処理と同じ規則で確かめる
const acceptedBy =
  (parse: (value: string) => unknown) =>
  (value: string): boolean => {
    try {
      parse(value);
      return true;
    } catch {
      return false;
    }
  };

export const mediaEnvShape = {
  IMAGE_DELIVERY_HOSTNAME: z.string().regex(HOSTNAME_PATTERN),
  IMAGE_DELIVERY_DEDICATED_HOST: z.enum(['true', 'false']),
  MODERATION_PROVIDER: z.enum(['rekognition', 'stub']),
  MODERATION_REGION: z.string().regex(MODERATION_REGION_PATTERN),
  MODERATION_MIN_CONFIDENCE: z.string().refine(acceptedBy(parseMinConfidence)),
  MODERATION_BLOCKED_CATEGORIES: z
    .string()
    .refine(acceptedBy(parseBlockedCategories)),
  REKOGNITION_ACCESS_KEY_ID: z.string().min(1).optional(),
  REKOGNITION_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  MEDIA_SMOKE_TOKEN: z.string().optional(),
} satisfies z.ZodRawShape;

// 判定サービスを使う環境(staging・prod)だけが資格情報を要し、代替の判定(ローカル・テスト)は要さない
export function requiredMediaConditionalKeys(
  env: Pick<EventMediaEnv, 'MODERATION_PROVIDER'>,
): readonly MediaConditionalKey[] {
  return env.MODERATION_PROVIDER === 'rekognition'
    ? REKOGNITION_CREDENTIAL_KEYS
    : [];
}
