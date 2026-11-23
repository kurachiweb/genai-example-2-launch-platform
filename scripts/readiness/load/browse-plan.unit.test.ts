import { describe, expect, test } from 'bun:test';

import {
  buildOptions,
  classifyStatus,
  formatLatencyTable,
  LOAD_THRESHOLDS,
  resolveLoadSettings,
  ROUTE_NAMES,
  visitPlan,
  waitSeconds,
} from './browse-plan.ts';

const VALID_ENV = {
  CLIENT_BASE_URL: 'https://client.example',
  API_BASE_URL: 'https://api.example',
  PRODUCT_HANDLES: 'alpha-product,beta-product',
  PROFILE_HANDLES: 'alice,bob',
} as const;

const settingsOf = (overrides: Record<string, string | undefined> = {}) =>
  resolveLoadSettings({ ...VALID_ENV, ...overrides });

const errorOf = (overrides: Record<string, string | undefined>): string => {
  try {
    settingsOf(overrides);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
};

describe('resolveLoadSettings', () => {
  test('既定は1並列あたり20人・15分で、見本のハンドルをカンマで分けて読む', () => {
    expect(settingsOf()).toEqual({
      clientBaseUrl: 'https://client.example',
      apiBaseUrl: 'https://api.example',
      productHandles: ['alpha-product', 'beta-product'],
      profileHandles: ['alice', 'bob'],
      vus: 20,
      duration: '15m',
      summaryPath: undefined,
    });
  });

  test('人数・時間・要約の出力先を環境変数で指定できる', () => {
    expect(
      settingsOf({ VUS: '1', DURATION: '90s', SUMMARY_PATH: '/tmp/out.json' }),
    ).toMatchObject({ vus: 1, duration: '90s', summaryPath: '/tmp/out.json' });
  });

  test('ハンドルの前後の空白と空の要素を取り除く', () => {
    expect(
      settingsOf({ PRODUCT_HANDLES: ' alpha , ,beta,', PROFILE_HANDLES: 'a' }),
    ).toMatchObject({
      productHandles: ['alpha', 'beta'],
      profileHandles: ['a'],
    });
  });

  test('末尾のスラッシュを取り除いた基底のURLにする', () => {
    expect(
      settingsOf({ CLIENT_BASE_URL: 'http://localhost:48044/' }),
    ).toMatchObject({ clientBaseUrl: 'http://localhost:48044' });
  });

  test.each(['CLIENT_BASE_URL', 'API_BASE_URL'])(
    '%sが無い、または空なら本番を既定にせず誤りにする',
    (name) => {
      expect(errorOf({ [name]: undefined })).toContain(name);
      expect(errorOf({ [name]: '' })).toContain(name);
    },
  );

  test.each([
    'client.example',
    'ftp://client.example',
    'https://client.example/path',
    'https://client.example?x=1',
    'https://user@client.example',
  ])('基底のURLとして読めない値%sを誤りにする', (value) => {
    expect(errorOf({ CLIENT_BASE_URL: value })).toContain('CLIENT_BASE_URL');
  });

  test.each(['PRODUCT_HANDLES', 'PROFILE_HANDLES'])(
    '%sが無い、または要素が1つも無いなら誤りにする',
    (name) => {
      expect(errorOf({ [name]: undefined })).toContain(name);
      expect(errorOf({ [name]: ' , ' })).toContain(name);
    },
  );

  test.each(['a/b', '-lead', 'あ', 'a b', '../x', 'a?b'])(
    'ハンドルとして不正な値%sを誤りにする',
    (value) => {
      expect(errorOf({ PRODUCT_HANDLES: `ok,${value}` })).toContain(
        'PRODUCT_HANDLES',
      );
    },
  );

  test.each(['0', '101', '2.5', 'abc', '', '-1'])(
    '仮想の利用者の人数%sを誤りにする',
    (value) => {
      expect(errorOf({ VUS: value })).toContain('VUS');
    },
  );

  test.each(['15', 'm', '1.5m', '1d', '0m', '15 m'])(
    '継続の時間%sを誤りにする',
    (value) => {
      expect(errorOf({ DURATION: value })).toContain('DURATION');
    },
  );
});

describe('visitPlan', () => {
  test('トップ・ディレクトリ・プロダクト詳細・公開プロフィール・ヘルプ・料金の順に巡り、最後に公開の照会を行う', () => {
    const plan = visitPlan(settingsOf(), 0);

    expect(plan).toEqual([
      { route: 'top', url: 'https://client.example/' },
      { route: 'directory', url: 'https://client.example/p' },
      {
        route: 'product',
        url: 'https://client.example/p/alpha-product',
      },
      { route: 'profile', url: 'https://client.example/@alice' },
      { route: 'help', url: 'https://client.example/help' },
      { route: 'pricing', url: 'https://client.example/pricing' },
      { route: 'public-api', url: 'https://api.example/v1/openapi.json' },
    ]);
    expect(plan.map(({ route }) => route)).toEqual([...ROUTE_NAMES]);
  });

  test('利用者の番号ごとに見本のハンドルを巡回して選ぶ', () => {
    const urls = (index: number) =>
      visitPlan(settingsOf(), index)
        .filter(({ route }) => route === 'product' || route === 'profile')
        .map(({ url }) => url);

    expect(urls(1)).toEqual([
      'https://client.example/p/beta-product',
      'https://client.example/@bob',
    ]);
    expect(urls(2)).toEqual(urls(0));
  });

  test('ハンドルが1つだけでも番号に関わらず同じ対象を巡る', () => {
    const settings = settingsOf({ PRODUCT_HANDLES: 'only' });

    expect(
      visitPlan(settings, 7).find(({ route }) => route === 'product')?.url,
    ).toBe('https://client.example/p/only');
  });
});

describe('waitSeconds', () => {
  test('乱数の下限は3秒、上限の直前は15秒の手前になる', () => {
    expect(waitSeconds(0)).toBe(3);
    expect(waitSeconds(0.5)).toBe(9);
    expect(waitSeconds(0.999_999)).toBeLessThan(15);
    expect(waitSeconds(0.999_999)).toBeGreaterThan(14.99);
  });
});

describe('classifyStatus', () => {
  test.each([
    [200, 'ok'],
    [500, 'server_error'],
    [503, 'server_error'],
    [599, 'server_error'],
    [0, 'server_error'],
    [429, 'rate_limited'],
    [404, 'unexpected'],
    [403, 'unexpected'],
    [401, 'unexpected'],
    [204, 'unexpected'],
  ] as const)('状態コード%dは%sに分類する', (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });
});

describe('LOAD_THRESHOLDS', () => {
  test('5xxの割合0・429の件数0・想定外の応答の件数0・95パーセンタイル300ms以下を閾値にする', () => {
    expect(LOAD_THRESHOLDS).toEqual({
      server_errors: ['rate==0'],
      rate_limited_responses: ['count==0'],
      unexpected_responses: ['count==0'],
      http_req_duration: ['p(95)<300'],
    });
  });
});

describe('buildOptions', () => {
  test('指定の人数と時間で一定の人数を保つ1つの場面と、閾値と要約の統計を返す', () => {
    const options = buildOptions(settingsOf({ VUS: '1', DURATION: '1m' }));

    expect(options.scenarios.browse).toEqual({
      executor: 'constant-vus',
      vus: 1,
      duration: '1m',
    });
    expect(options.thresholds).toEqual(LOAD_THRESHOLDS);
    expect(options.summaryTrendStats).toContain('p(95)');
    expect(options.summaryTrendStats).toContain('count');
  });
});

describe('formatLatencyTable', () => {
  test('操作ごとの標本数と95パーセンタイルを、閾値との比較の判定を付けた表にする', () => {
    const table = formatLatencyTable([
      { operation: 'top', samples: 120, p95Ms: 250.456 },
      { operation: 'help', samples: 118, p95Ms: 300 },
      { operation: 'pricing', samples: 119, p95Ms: 412.2 },
      { operation: 'profile', samples: 0, p95Ms: Number.NaN },
    ]);

    expect(table).toBe(
      [
        '| 操作 | 標本数 | 95パーセンタイル(ms) | 判定 |',
        '| --- | ---: | ---: | --- |',
        '| top | 120 | 250.5 | 合格 |',
        '| help | 118 | 300 | 不合格 |',
        '| pricing | 119 | 412.2 | 不合格 |',
        '| profile | 0 | - | 標本不足 |',
      ].join('\n'),
    );
  });
});
