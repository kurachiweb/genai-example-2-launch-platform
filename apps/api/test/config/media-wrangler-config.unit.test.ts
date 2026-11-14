import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  MEDIA_CONFIG_KEY_PATTERN,
  readWranglerConfig,
  type WranglerAppName,
} from '../support/wrangler-config.ts';

const workerExportSchema = z.object({
  type: z.string(),
  cache: z
    .object({
      enabled: z.boolean(),
      cross_version_cache: z.boolean().optional(),
    })
    .optional(),
});

const mediaConfigSchema = z.object({
  cache: z
    .object({
      enabled: z.boolean(),
      cross_version_cache: z.boolean().optional(),
    })
    .optional(),
  exports: z.record(z.string(), workerExportSchema).optional(),
  vars: z.record(z.string(), z.unknown()),
  secrets: z.object({ required: z.array(z.string()) }).optional(),
});

type MediaConfig = z.infer<typeof mediaConfigSchema>;

const MODERATION_CATEGORIES = [
  'Explicit',
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Swimwear or Underwear',
  'Violence',
  'Visually Disturbing',
  'Drugs & Tobacco',
  'Alcohol',
  'Rude Gestures',
  'Gambling',
  'Hate Symbols',
] as const;

const SMOKE_TOKEN_KEY = 'MEDIA_SMOKE_TOKEN';

const MODERATION_SECRET_KEYS = [
  'REKOGNITION_ACCESS_KEY_ID',
  'REKOGNITION_SECRET_ACCESS_KEY',
] as const;

const SECRET_LIKE_KEY_PATTERN = /TOKEN|SECRET|PASSWORD|ACCESS_KEY|DSN|PEPPER/;

// 既定のエクスポート(APIの経路)の応答はキャッシュせず、画像配信の名前付きエントリポイントの応答だけをキャッシュする。版をまたぐキャッシュは使わない
const EXPECTED_EXPORTS = {
  default: { type: 'worker', cache: { enabled: false } },
  ImageDelivery: { type: 'worker', cache: { enabled: true } },
} as const;

interface ExpectedMediaEnvironment {
  readonly label: string;
  readonly wranglerEnv: string | undefined;
  readonly vars: Readonly<Record<string, string>>;
  readonly requiredMediaSecrets: readonly string[];
}

function mediaVars(
  imageDeliveryHostname: string,
  dedicatedHost: boolean,
  moderationProvider: 'stub' | 'rekognition',
): Readonly<Record<string, string>> {
  return {
    IMAGE_DELIVERY_HOSTNAME: imageDeliveryHostname,
    IMAGE_DELIVERY_DEDICATED_HOST: String(dedicatedHost),
    MODERATION_PROVIDER: moderationProvider,
    MODERATION_REGION: 'us-east-1',
    MODERATION_MIN_CONFIDENCE: '60',
    MODERATION_BLOCKED_CATEGORIES: MODERATION_CATEGORIES.join(','),
  };
}

const EXPECTED_ENVIRONMENTS: readonly ExpectedMediaEnvironment[] = [
  {
    label: 'ローカル(ルート)',
    wranglerEnv: undefined,
    vars: mediaVars('localhost', false, 'stub'),
    // wrangler devはsecrets.requiredのキーだけをenvへ渡すため、動作確認の経路を使うローカルにだけ挙げる。ローカルは代替の判定を使い、判定サービスのキーを注入せずに起動する
    requiredMediaSecrets: [SMOKE_TOKEN_KEY],
  },
  {
    label: 'staging',
    wranglerEnv: 'staging',
    vars: mediaVars(
      'genai-example-2-images-staging.lab.kurachiweb.com',
      true,
      'rekognition',
    ),
    // 動作確認のトークンは任意のシークレットとして渡すため、必須に挙げると登録前のデプロイが失敗する
    requiredMediaSecrets: MODERATION_SECRET_KEYS,
  },
  {
    label: 'prod',
    wranglerEnv: 'prod',
    vars: mediaVars(
      'genai-example-2-images.lab.kurachiweb.com',
      true,
      'rekognition',
    ),
    requiredMediaSecrets: MODERATION_SECRET_KEYS,
  },
];

function readConfig(
  app: WranglerAppName,
  wranglerEnv: string | undefined,
): MediaConfig {
  return mediaConfigSchema.parse(readWranglerConfig(app, wranglerEnv));
}

function mediaKeysOf(keys: readonly string[]): string[] {
  return keys.filter((key) => MEDIA_CONFIG_KEY_PATTERN.test(key));
}

describe.each(EXPECTED_ENVIRONMENTS)(
  'メディアのWrangler設定($label)',
  (env) => {
    const event = readConfig('event', env.wranglerEnv);
    const api = readConfig('api', env.wranglerEnv);

    test('イベントサーバーのWorkerの前段のキャッシュを無効にし、版をまたぐキャッシュを使わない', () => {
      expect(event.cache).toStrictEqual({ enabled: false });
    });

    test('既定のエクスポートはキャッシュを無効に、画像配信の名前付きエントリポイントは有効にする', () => {
      expect(event.exports).toStrictEqual(EXPECTED_EXPORTS);
    });

    test('イベントサーバーが環境ごとの画像配信と画像判定の変数を持つ', () => {
      expect(
        Object.fromEntries(
          Object.entries(event.vars).filter(([key]) =>
            MEDIA_CONFIG_KEY_PATTERN.test(key),
          ),
        ),
      ).toStrictEqual(env.vars);
    });

    test('メディアの必須シークレットは、ローカルが動作確認のトークン、デプロイ先が判定サービスの2つのキーである', () => {
      expect(mediaKeysOf(event.secrets?.required ?? [])).toEqual([
        ...env.requiredMediaSecrets,
      ]);
    });

    test('デプロイ先は動作確認のトークンを必須のシークレットに挙げない', () => {
      const required = event.secrets?.required ?? [];

      expect(required.includes(SMOKE_TOKEN_KEY)).toBe(
        env.wranglerEnv === undefined,
      );
    });

    test('メディアの変数にシークレットにすべき項目が無い', () => {
      const mediaVarKeys = mediaKeysOf(Object.keys(event.vars));

      for (const key of [SMOKE_TOKEN_KEY, ...MODERATION_SECRET_KEYS]) {
        expect(mediaVarKeys).not.toContain(key);
      }
      expect(
        mediaVarKeys.filter((key) => SECRET_LIKE_KEY_PATTERN.test(key)),
      ).toEqual([]);
    });

    test('APIサーバーはメディアの変数・シークレットと名前付きエクスポートを持たない', () => {
      expect(mediaKeysOf(Object.keys(api.vars))).toEqual([]);
      expect(mediaKeysOf(api.secrets?.required ?? [])).toEqual([]);
      expect(api.exports ?? {}).toStrictEqual({});
    });
  },
);
