import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  readWranglerConfig,
  SEARCH_CONFIG_KEY_PATTERN,
  type WranglerAppName,
} from '../support/wrangler-config.ts';

const searchConfigSchema = z.object({
  vars: z.record(z.string(), z.unknown()),
  secrets: z.object({ required: z.array(z.string()) }).optional(),
});

type SearchConfig = z.infer<typeof searchConfigSchema>;

interface ExpectedSearchEnvironment {
  readonly label: string;
  readonly wranglerEnv: string | undefined;
  readonly keywordExtractor: 'disabled' | 'google-natural-language';
  readonly requiredSearchSecrets: readonly string[];
}

const EXPECTED_ENVIRONMENTS: readonly ExpectedSearchEnvironment[] = [
  {
    label: 'ローカル(ルート)',
    wranglerEnv: undefined,
    keywordExtractor: 'disabled',
    // ローカルは外部APIを呼ばないため、キーを注入せずに起動できるようにする
    requiredSearchSecrets: [],
  },
  {
    label: 'staging',
    wranglerEnv: 'staging',
    keywordExtractor: 'google-natural-language',
    requiredSearchSecrets: ['GOOGLE_NL_API_KEY'],
  },
  {
    label: 'prod',
    wranglerEnv: 'prod',
    keywordExtractor: 'google-natural-language',
    requiredSearchSecrets: ['GOOGLE_NL_API_KEY'],
  },
];

function readConfig(
  app: WranglerAppName,
  wranglerEnv: string | undefined,
): SearchConfig {
  return searchConfigSchema.parse(readWranglerConfig(app, wranglerEnv));
}

function searchKeysOf(keys: readonly string[]): string[] {
  return keys.filter((key) => SEARCH_CONFIG_KEY_PATTERN.test(key));
}

describe.each(EXPECTED_ENVIRONMENTS)(
  'キーワード抽出のWrangler設定($label)',
  (env) => {
    const event = readConfig('event', env.wranglerEnv);
    const api = readConfig('api', env.wranglerEnv);

    test('イベントサーバーが環境ごとのキーワード抽出の実装の変数を持つ', () => {
      expect(
        Object.fromEntries(
          Object.entries(event.vars).filter(([key]) =>
            SEARCH_CONFIG_KEY_PATTERN.test(key),
          ),
        ),
      ).toStrictEqual({ KEYWORD_EXTRACTOR: env.keywordExtractor });
    });

    test('抽出を有効にした環境だけが外部APIのキーを必須のシークレットにする', () => {
      expect(searchKeysOf(event.secrets?.required ?? [])).toEqual([
        ...env.requiredSearchSecrets,
      ]);
    });

    test('外部APIのキーを変数に書かない', () => {
      expect(Object.keys(event.vars)).not.toContain('GOOGLE_NL_API_KEY');
    });

    test('APIサーバーはキーワード抽出の変数とシークレットを持たない', () => {
      expect(searchKeysOf(Object.keys(api.vars))).toEqual([]);
      expect(searchKeysOf(api.secrets?.required ?? [])).toEqual([]);
    });
  },
);
