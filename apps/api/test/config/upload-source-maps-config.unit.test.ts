import { describe, expect, test } from 'bun:test';

import { readWranglerConfig } from '../support/wrangler-config.ts';

describe.each(['api', 'event'] as const)(
  '%sのWrangler設定のソースマップ',
  (app) => {
    test.each([undefined, 'staging', 'prod'])(
      '環境%sでも、バンドルのソースマップを出力してCloudflareへ送る設定にする',
      (wranglerEnv) => {
        expect(readWranglerConfig(app, wranglerEnv)).toMatchObject({
          upload_source_maps: true,
        });
      },
    );
  },
);
