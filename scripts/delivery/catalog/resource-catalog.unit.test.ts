import { describe, expect, test } from 'bun:test';

import {
  PLACEHOLDER_CLOUDFLARE_ID,
  PLACEHOLDER_UUID,
  PROJECT_ID,
  validCatalogJson,
} from '../test-fixtures/resource-catalog.ts';
import {
  type CatalogParseResult,
  isPlaceholderId,
  isUuid,
  parseResourceCatalog,
  resourceCatalogPath,
} from './resource-catalog.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const replacedAt = (
  value: unknown,
  path: readonly string[],
  replacement: unknown,
): unknown => {
  const [head, ...rest] = path;
  if (head === undefined) return replacement;
  if (Array.isArray(value)) {
    const index = Number(head);
    return value.map((item: unknown, i) =>
      i === index ? replacedAt(item, rest, replacement) : item,
    );
  }
  if (!isRecord(value)) throw new Error(`${head}の親がオブジェクトでない`);
  if (rest.length === 0 && replacement === undefined) {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== head),
    );
  }
  return { ...value, [head]: replacedAt(value[head], rest, replacement) };
};

const catalogWith = (dottedPath: string, replacement: unknown): unknown =>
  replacedAt(validCatalogJson(), dottedPath.split('.'), replacement);

const errorPathsOf = (result: CatalogParseResult): readonly string[] =>
  result.ok
    ? []
    : result.errors.map((error) => error.slice(0, error.indexOf(': ')));

describe('parseResourceCatalog', () => {
  test('正しい資源一覧を、同じ値の資源一覧として返す', () => {
    const json = validCatalogJson();

    const result = parseResourceCatalog(json);

    expect(result).toEqual({ ok: true, catalog: json as never });
  });

  test('期待する環境と一致する資源一覧を受け入れる', () => {
    const result = parseResourceCatalog(validCatalogJson(), 'staging');

    expect(result.ok).toBe(true);
  });

  test('後続specが加えた資源の項目も受け入れる', () => {
    const json = replacedAt(
      replacedAt(validCatalogJson(), ['r2', 'exports'], {
        name: 'app-exports-staging',
      }),
      ['hostnames', 'docs'],
      { hostname: 'docs-staging.launch.example', worker: 'client' },
    );

    const result = parseResourceCatalog(json);

    expect(result.ok).toBe(true);
  });

  test.each([
    'environment',
    'cloudflare',
    'cloudflare.accountId',
    'cloudflare.zoneId',
    'cloudflare.zoneName',
    'jurisdiction',
    'd1',
    'd1.main.name',
    'r2',
    'queues',
    'queues.jobs.name',
    'workers',
    'workers.admin',
    'workers.api.name',
    'hostnames',
    'hostnames.api.worker',
    'turnstile',
    'turnstile.mode',
    'webAnalytics.hostname',
    'emailSending.domain',
    'emailSending.eventsQueue',
    'emailSending.events',
    'emailSending.subscriptionName',
    'state',
    'state.bucket',
    'state.key',
    'infisical',
    'infisical.host',
    'infisical.projectId',
    'infisical.identityId',
    'infisical.oidcAudience',
    'github',
    'github.branch',
  ])('必須の項目%sが欠けていれば、その項目のパスを誤りとして返す', (path) => {
    const result = parseResourceCatalog(catalogWith(path, undefined));

    expect(result.ok).toBe(false);
    expect(errorPathsOf(result)).toEqual([path]);
  });

  test.each([
    ['environment', 'dev'],
    ['cloudflare.accountId', 'not-an-id'],
    ['cloudflare.zoneId', 'FEDCBA9876543210FEDCBA9876543210'],
    ['cloudflare.zoneName', ''],
    ['jurisdiction', 'eu'],
    ['d1.main', 'app-staging'],
    ['d1.main.name', 1],
    ['r2.images.name', ''],
    ['queues', []],
    ['workers.api.name', null],
    ['hostnames.api.hostname', 42],
    ['hostnames.api.worker', 'web'],
    ['turnstile.name', ''],
    ['turnstile.hostnames', 'client-staging.launch.example'],
    ['turnstile.hostnames', []],
    ['turnstile.hostnames.0', 1],
    ['turnstile.mode', 'managed'],
    ['emailSending.events', []],
    ['emailSending.events.0', 'message.delivered'],
    ['state.bucket', ''],
    ['infisical.host', 'http://secrets.launch.example'],
    ['infisical.projectId', 'project'],
    ['infisical.identityId', '0F8B1C2D-3E4F-4A5B-8C6D-7E8F9A0B1C2D'],
    ['infisical.oidcAudience', ''],
    ['github.environment', 'production'],
    ['github.branch', 'develop'],
  ])(
    '項目%sの型や値の形が誤っていれば(%p)、その項目のパスを誤りとして返す',
    (path, value) => {
      const result = parseResourceCatalog(catalogWith(path, value));

      expect(errorPathsOf(result)).toEqual([path.replace(/\.(\d+)$/, '[$1]')]);
    },
  );

  test.each([[null], [[]], ['staging'], [1]])(
    '資源一覧がオブジェクトでなければ(%p)、最上位の誤りを返す',
    (json) => {
      const result = parseResourceCatalog(json);

      expect(errorPathsOf(result)).toEqual(['(最上位)']);
    },
  );

  test('Workerの一覧に4つのWorker以外があれば、そのWorkerのパスを誤りとして返す', () => {
    const result = parseResourceCatalog(
      catalogWith('workers.web', { name: 'app-web-staging' }),
    );

    expect(errorPathsOf(result)).toEqual(['workers.web']);
  });

  test('Workerの項目に名前以外があれば、その項目のパスを誤りとして返す(アプリのディレクトリはアプリの一覧から引く)', () => {
    const result = parseResourceCatalog(
      catalogWith('workers.api.appDir', 'apps/api'),
    );

    expect(errorPathsOf(result)).toEqual(['workers.api.appDir']);
  });

  test.each(['d1', 'r2', 'queues', 'hostnames'])(
    '%sのキーが英小文字で始まらないか英小文字・数字・ハイフン以外を含めば、そのキーのパスを誤りとして返す',
    (map) => {
      const original = validCatalogJson()[map] as Record<string, unknown>;
      const [firstKey, firstValue] = Object.entries(original)[0] ?? [];
      if (firstKey === undefined) throw new Error(`${map}が空`);
      const json = replacedAt(
        replacedAt(validCatalogJson(), [map, firstKey], undefined),
        [map, 'Upper_Case'],
        firstValue,
      );

      const result = parseResourceCatalog(json);

      expect(errorPathsOf(result)).toContain(`${map}.Upper_Case`);
    },
  );

  test('複数の誤りをまとめて返す', () => {
    const json = replacedAt(
      catalogWith('jurisdiction', 'eu'),
      ['state', 'bucket'],
      undefined,
    );

    const result = parseResourceCatalog(json);

    expect(errorPathsOf(result)).toEqual(['jurisdiction', 'state.bucket']);
  });

  describe('不変条件', () => {
    test.each([
      ['api.other.example', 'ゾーンと別のドメイン'],
      ['api-staging.evillaunch.example', 'ゾーン名を部分文字列として含むだけ'],
      ['launch.example', 'ゾーンの頂点'],
    ])(
      'ホスト名がゾーン名で終わらなければ(%s: %s)、そのホスト名の項目を誤りとして返す',
      (hostname) => {
        const result = parseResourceCatalog(
          catalogWith('hostnames.api.hostname', hostname),
        );

        expect(errorPathsOf(result)).toEqual(['hostnames.api.hostname']);
      },
    );

    test('送信ドメインがゾーン名で終わらなければ誤りとして返す', () => {
      const result = parseResourceCatalog(
        catalogWith('emailSending.domain', 'mail.other.example'),
      );

      expect(errorPathsOf(result)).toEqual(['emailSending.domain']);
    });

    test('bot判定の対象のホスト名がホスト名の一覧に無ければ誤りとして返す', () => {
      const result = parseResourceCatalog(
        catalogWith('turnstile.hostnames.1', 'other-staging.launch.example'),
      );

      expect(errorPathsOf(result)).toEqual(['turnstile.hostnames[1]']);
    });

    test('アクセス解析の対象のホスト名がホスト名の一覧に無ければ誤りとして返す', () => {
      const result = parseResourceCatalog(
        catalogWith('webAnalytics.hostname', 'other-staging.launch.example'),
      );

      expect(errorPathsOf(result)).toEqual(['webAnalytics.hostname']);
    });

    test('配信不能イベントの受け皿が非同期メッセージの一覧のキーに無ければ誤りとして返す', () => {
      const result = parseResourceCatalog(
        catalogWith('emailSending.eventsQueue', 'app-email-events-staging'),
      );

      expect(errorPathsOf(result)).toEqual(['emailSending.eventsQueue']);
    });

    test('配信不能イベントの種類が重複していれば誤りとして返す', () => {
      const result = parseResourceCatalog(
        catalogWith('emailSending.events.1', 'message.bounced'),
      );

      expect(errorPathsOf(result)).toEqual(['emailSending.events[1]']);
    });

    test('GitHubのEnvironmentが資源一覧の環境と異なれば誤りとして返す', () => {
      const result = parseResourceCatalog(
        catalogWith('github.environment', 'prod'),
      );

      expect(errorPathsOf(result)).toEqual(['github.environment']);
    });

    test('資源一覧の環境が期待する環境(ファイル名)と異なれば誤りとして返す', () => {
      const result = parseResourceCatalog(validCatalogJson(), 'prod');

      expect(errorPathsOf(result)).toEqual(['environment']);
    });

    test('構造に誤りがあれば、不変条件の誤りを重ねて返さない', () => {
      const json = replacedAt(
        catalogWith('cloudflare.zoneName', undefined),
        ['emailSending', 'eventsQueue'],
        'missing',
      );

      const result = parseResourceCatalog(json);

      expect(errorPathsOf(result)).toEqual(['cloudflare.zoneName']);
    });
  });

  test('誤りの理由を項目のパスの後に添える', () => {
    const result = parseResourceCatalog(catalogWith('jurisdiction', 'eu'));

    expect(result.ok ? [] : result.errors).toEqual([
      'jurisdiction: "us"のいずれかが必要です(実際: "eu")',
    ]);
  });
});

describe('isPlaceholderId', () => {
  test.each([PLACEHOLDER_UUID, PLACEHOLDER_CLOUDFLARE_ID])(
    '全桁0の識別子%sを仮の値と判定する',
    (value) => {
      expect(isPlaceholderId(value)).toBe(true);
    },
  );

  test.each([
    PROJECT_ID,
    '0123456789abcdef0123456789abcdef',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000000',
    '0000000000000000000000000000000',
    '0',
    '',
  ])('全桁0の識別子でない%pを仮の値と判定しない', (value) => {
    expect(isPlaceholderId(value)).toBe(false);
  });
});

describe('isUuid', () => {
  test.each([PROJECT_ID, PLACEHOLDER_UUID])(
    '英小文字の16進のUUID%sを受け入れる',
    (value) => {
      expect(isUuid(value)).toBe(true);
    },
  );

  test.each([
    '0F8B1C2D-3E4F-4A5B-8C6D-7E8F9A0B1C2D',
    '0f8b1c2d3e4f4a5b8c6d7e8f9a0b1c2d',
    ` ${PROJECT_ID}`,
    '',
  ])('UUIDの形でない%pを受け入れない', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('resourceCatalogPath', () => {
  test.each([
    ['staging', 'apps/infra/environments/staging.json'],
    ['prod', 'apps/infra/environments/prod.json'],
  ] as const)('環境%sの資源一覧のリポジトリ内のパスを返す', (env, expected) => {
    expect(resourceCatalogPath(env)).toBe(expected);
  });
});
