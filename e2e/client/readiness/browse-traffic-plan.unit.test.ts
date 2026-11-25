import { describe, expect, test } from 'bun:test';

import {
  browsePathsOf,
  DEFAULT_MANIFEST_PATH,
  parseTrafficSamples,
  resolveBrowseTraffic,
} from './browse-traffic-plan.ts';

const MANIFEST = {
  samples: {
    productHandles: ['synthetic-p-000001', 'synthetic-p-000002'],
    profileHandles: ['synthetic-u-000001', 'synthetic-u-000002'],
    largeHelpArticleHandle: ['synthetic-help-max-length'],
  },
};

describe('resolveBrowseTraffic', () => {
  test('時間の環境変数が未設定か空文字なら対象外にする', () => {
    for (const env of [{}, { READINESS_TRAFFIC_SECONDS: '' }]) {
      const result = resolveBrowseTraffic(env);

      expect(result.kind).toBe('skip');
    }
  });

  test('秒数の整数を繰り返す時間のミリ秒にし、見本の一覧は既定のパスを使う', () => {
    expect(resolveBrowseTraffic({ READINESS_TRAFFIC_SECONDS: '60' })).toEqual({
      kind: 'run',
      durationMs: 60_000,
      manifestPath: DEFAULT_MANIFEST_PATH,
    });
  });

  test('見本の一覧のパスを環境変数で上書きでき、空文字は未設定と同じ', () => {
    expect(
      resolveBrowseTraffic({
        READINESS_TRAFFIC_SECONDS: '5',
        READINESS_TRAFFIC_MANIFEST: '/var/data/manifest.json',
      }),
    ).toMatchObject({ manifestPath: '/var/data/manifest.json' });
    expect(
      resolveBrowseTraffic({
        READINESS_TRAFFIC_SECONDS: '5',
        READINESS_TRAFFIC_MANIFEST: '',
      }),
    ).toMatchObject({ manifestPath: DEFAULT_MANIFEST_PATH });
  });

  test.each(['0', '-5', '1.5', '1m', 'abc', ' '])(
    '正の整数の秒数でない値(%s)は誤りにする',
    (value) => {
      expect(() =>
        resolveBrowseTraffic({ READINESS_TRAFFIC_SECONDS: value }),
      ).toThrow('READINESS_TRAFFIC_SECONDS');
    },
  );
});

describe('parseTrafficSamples', () => {
  test('一覧の見本のハンドルから、プロダクト・利用者・本文が上限のヘルプ記事を読む', () => {
    expect(parseTrafficSamples(MANIFEST)).toEqual({
      productHandles: ['synthetic-p-000001', 'synthetic-p-000002'],
      profileHandles: ['synthetic-u-000001', 'synthetic-u-000002'],
      helpArticleHandle: 'synthetic-help-max-length',
    });
  });

  test.each([
    ['null', null],
    ['見本が無い', {}],
    [
      'プロダクトのハンドルが空',
      {
        samples: { ...MANIFEST.samples, productHandles: [] },
      },
    ],
    [
      '利用者のハンドルが文字列でない',
      {
        samples: { ...MANIFEST.samples, profileHandles: [1] },
      },
    ],
    [
      'ヘルプ記事のハンドルが無い',
      {
        samples: { ...MANIFEST.samples, largeHelpArticleHandle: [] },
      },
    ],
    [
      'ハンドルに使えない文字を含む',
      {
        samples: { ...MANIFEST.samples, productHandles: ['a/../b'] },
      },
    ],
  ])('%sなら誤りにする', (_, manifest) => {
    expect(() => parseTrafficSamples(manifest)).toThrow('見本');
  });
});

describe('browsePathsOf', () => {
  const samples = parseTrafficSamples(MANIFEST);

  test('主要6ページと本文が上限のヘルプ記事の詳細を、この順に返す', () => {
    expect(browsePathsOf(samples, 0)).toEqual([
      '/',
      '/p',
      '/p/synthetic-p-000001',
      '/@synthetic-u-000001',
      '/help',
      '/pricing',
      '/help/synthetic-help-max-length',
    ]);
  });

  test('周回ごとに見本のプロダクトと利用者を順に替え、一覧の末尾の次は先頭に戻る', () => {
    expect(browsePathsOf(samples, 1)).toContain('/p/synthetic-p-000002');
    expect(browsePathsOf(samples, 1)).toContain('/@synthetic-u-000002');
    expect(browsePathsOf(samples, 2)).toEqual(browsePathsOf(samples, 0));
  });
});
