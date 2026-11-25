import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildDegradedCommands,
  buildDegradedLaunches,
  type DegradationRow,
  DEGRADATION_MATRIX,
  EXTERNAL_SERVICES,
  isExternalService,
  LOCAL_OVERRIDES,
  rowsWithoutEvidence,
  rowsWithoutNotification,
  servicesWithoutOverride,
} from './degraded-overrides.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const SECRET_LIKE_PATTERNS: readonly RegExp[] = [
  /rk_(?:test|live)_/u,
  /sk_(?:test|live)_/u,
  /whsec_/u,
  /AKIA[0-9A-Z]{8,}/u,
  /AIza[0-9A-Za-z_-]{8,}/u,
];

const CREDENTIAL_KEY_PATTERN = /(?:^|_)(?:KEY|SECRET|TOKEN)(?:_|$)/u;

interface WranglerShape {
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly secrets?: { readonly required?: readonly string[] };
  readonly env?: Readonly<Record<string, WranglerShape>>;
}

const readJson = (path: string): unknown =>
  Bun.JSONC.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));

const wranglerOf = (worker: 'api' | 'event'): WranglerShape =>
  readJson(`apps/${worker}/wrangler.jsonc`) as WranglerShape;

const localSecretKeysOf = (worker: 'api' | 'event'): readonly string[] =>
  wranglerOf(worker).secrets?.required ?? [];

const declaredKeysOf = (worker: 'api' | 'event'): ReadonlySet<string> => {
  const config = wranglerOf(worker);
  const scopes = [config, ...Object.values(config.env ?? {})];
  return new Set(
    scopes.flatMap((scope) => [
      ...Object.keys(scope.vars ?? {}),
      ...(scope.secrets?.required ?? []),
    ]),
  );
};

const devScriptArgsOf = (worker: 'api' | 'event'): string => {
  const { scripts } = readJson(`apps/${worker}/package.json`) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
  const dev = scripts['dev'] ?? '';
  return dev.slice(dev.indexOf('wrangler dev') + 'wrangler dev'.length).trim();
};

const rowOf = (overrides: Partial<DegradationRow> = {}): DegradationRow => ({
  service: 'stripe',
  failure: 'timeout',
  expected: '期待する振る舞い',
  evidence: ['apps/api/package.json'],
  notifiesOperator: true,
  owner: 'payments',
  ...overrides,
});

describe('対応表', () => {
  test('6つの外部サービスの全てに行がある', () => {
    expect([...EXTERNAL_SERVICES]).toEqual([
      'rekognition',
      'gcp-nl',
      'stripe',
      'email',
      'hibp',
      'disify',
    ]);
    const covered = new Set(DEGRADATION_MATRIX.map(({ service }) => service));

    expect(
      EXTERNAL_SERVICES.filter((service) => !covered.has(service)),
    ).toEqual([]);
  });

  test('各サービスは障害の種類を重ねずに持ち、時間切れを含む', () => {
    for (const service of EXTERNAL_SERVICES) {
      const kinds = DEGRADATION_MATRIX.filter(
        (row) => row.service === service,
      ).map(({ failure }) => failure);

      expect(new Set(kinds).size).toBe(kinds.length);
      expect(kinds).toContain('timeout');
    }
  });

  test('各行は期待する振る舞いと担当specを持ち、担当specのディレクトリが存在する', () => {
    const invalid = DEGRADATION_MATRIX.filter(
      ({ expected, owner }) =>
        expected.trim() === '' ||
        !existsSync(resolve(REPO_ROOT, '.kiro', 'specs', owner)),
    );

    expect(invalid).toEqual([]);
  });

  test('証跡に挙げたファイルが全て存在する(書き誤りの検出)', () => {
    const missing = DEGRADATION_MATRIX.flatMap(
      ({ service, failure, evidence }) =>
        evidence
          .filter((path) => !existsSync(resolve(REPO_ROOT, path)))
          .map((path) => `${service}/${failure}: ${path}`),
    );

    expect(missing).toEqual([]);
  });

  test('証跡は上流の自動テストのファイルだけで、同じ行に重複しない', () => {
    const invalid = DEGRADATION_MATRIX.flatMap(
      ({ service, failure, evidence }) => [
        ...evidence
          .filter((path) => !/\.(?:unit|worker)\.test\.ts$/u.test(path))
          .map((path) => `${service}/${failure}: ${path}`),
        ...(new Set(evidence).size === evidence.length
          ? []
          : [`${service}/${failure}: 重複`]),
      ],
    );

    expect(invalid).toEqual([]);
  });

  test('運用者へ通知されないことを確かめた行が、通知されない行として挙がる', () => {
    const silent = rowsWithoutNotification(DEGRADATION_MATRIX).map(
      ({ service, failure }) => `${service}/${failure}`,
    );

    expect(silent).toEqual([
      'gcp-nl/timeout',
      'gcp-nl/quota',
      'stripe/timeout',
      'stripe/quota',
      'stripe/bad-response',
    ]);
  });

  test('Stripeの認証の失敗は、想定外の例外としてSentryへ届くが決済の障害として区別されないことを表す', () => {
    const row = DEGRADATION_MATRIX.find(
      ({ service, failure }) => service === 'stripe' && failure === 'auth',
    );

    expect(row?.notifiesOperator).toBe(true);
    expect(row?.expected).toContain('想定外の例外としてSentryへ届く');
    expect(row?.expected).toContain('決済の障害として区別されない');
    expect(row?.expected).toContain('汎用のエラー(internal_error)');
  });
});

describe('証跡の無い行と通知されない行の抽出', () => {
  test('証跡が空の行だけを、挙げた順に返す', () => {
    const rows = [
      rowOf({ failure: 'timeout' }),
      rowOf({ failure: 'auth', evidence: [] }),
      rowOf({ failure: 'quota' }),
      rowOf({ failure: 'bad-response', evidence: [] }),
    ];

    expect(rowsWithoutEvidence(rows).map(({ failure }) => failure)).toEqual([
      'auth',
      'bad-response',
    ]);
  });

  test('証跡の無い行が無ければ空を返す', () => {
    expect(rowsWithoutEvidence([rowOf()])).toEqual([]);
    expect(rowsWithoutEvidence([])).toEqual([]);
  });

  test('通知の無い行だけを返す', () => {
    const rows = [
      rowOf({ failure: 'timeout', notifiesOperator: true }),
      rowOf({ failure: 'auth', notifiesOperator: false }),
    ];

    expect(rowsWithoutNotification(rows).map(({ failure }) => failure)).toEqual(
      ['auth'],
    );
  });
});

describe('ローカルの差し替え', () => {
  test('HIBPだけが差し替えの手段を持たず、他の5つは持つ', () => {
    const overridden = new Set(LOCAL_OVERRIDES.map(({ service }) => service));

    expect(
      EXTERNAL_SERVICES.filter((service) => !overridden.has(service)),
    ).toEqual(['hibp']);
    expect(servicesWithoutOverride(EXTERNAL_SERVICES)).toEqual(['hibp']);
  });

  test('差し替えの変数とシークレットのキーが、そのWorkerのWrangler設定のどれかの環境に存在する', () => {
    const missing = LOCAL_OVERRIDES.flatMap(
      ({ service, worker, vars, unsetSecrets }) => {
        const declared = declaredKeysOf(worker);
        return [...Object.keys(vars), ...unsetSecrets]
          .filter((key) => !declared.has(key))
          .map((key) => `${service}/${worker}: ${key}`);
      },
    );

    expect(missing).toEqual([]);
  });

  test('外すシークレットは、ローカルの`secrets.required`にあり実際に注入されるキーに限る', () => {
    const notInjected = LOCAL_OVERRIDES.flatMap(
      ({ service, worker, unsetSecrets }) =>
        unsetSecrets
          .filter((key) => !localSecretKeysOf(worker).includes(key))
          .map((key) => `${service}/${worker}: ${key}`),
    );

    expect(notInjected).toEqual([]);
  });

  test('`--var`で渡す変数は、ローカルの`secrets.required`に無いキーか、ローカルの`vars`にあるキーである', () => {
    const shadowed = LOCAL_OVERRIDES.flatMap(({ service, worker, vars }) =>
      Object.keys(vars)
        .filter((key) => localSecretKeysOf(worker).includes(key))
        .map((key) => `${service}/${worker}: ${key}`),
    );

    expect(shadowed).toEqual([]);
  });

  test('同じWorkerの差し替えが同じキーを重ねて定めない', () => {
    for (const worker of ['api', 'event'] as const) {
      const keys = LOCAL_OVERRIDES.filter(
        (override) => override.worker === worker,
      ).flatMap(({ vars, unsetSecrets }) => [
        ...Object.keys(vars),
        ...unsetSecrets,
      ]);

      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test('認証の鍵に当たる変数は、本物でない同じ固定の値だけにする', () => {
    const credentialValues = LOCAL_OVERRIDES.flatMap(({ vars }) =>
      Object.entries(vars)
        .filter(([key]) => CREDENTIAL_KEY_PATTERN.test(key))
        .map(([, value]) => value),
    );

    expect(credentialValues.length).toBeGreaterThan(0);
    expect(new Set(credentialValues).size).toBe(1);
    expect(credentialValues[0]).toStartWith('degraded-invalid-');
  });

  test('Stripeは無効な鍵でなく鍵を外して、決済の縮退の案内(`payments_unavailable`)に倒す', () => {
    const stripe = LOCAL_OVERRIDES.filter(
      ({ service }) => service === 'stripe',
    );

    expect(stripe.map(({ worker }) => worker).toSorted()).toEqual([
      'api',
      'event',
    ]);
    for (const { unsetSecrets, vars } of stripe) {
      expect(unsetSecrets).toEqual(['STRIPE_API_KEY']);
      expect(vars).toEqual({});
    }
  });

  test('メールはイベントサーバーのMailpitの宛先を、接続できないポートへ替える', () => {
    const email = LOCAL_OVERRIDES.filter(({ service }) => service === 'email');

    expect(email).toHaveLength(1);
    expect(email[0]?.worker).toBe('event');
    expect(email[0]?.vars['MAILPIT_API_URL']).toBe('http://127.0.0.1:1');
  });

  test('RekognitionとGCP NLは、ローカルで外す既定の代替を外して無効な鍵で外部へ向ける', () => {
    const vars = LOCAL_OVERRIDES.filter(
      ({ service }) => service === 'rekognition' || service === 'gcp-nl',
    ).flatMap(({ vars: own }) => Object.keys(own));

    expect(vars.toSorted()).toEqual([
      'GOOGLE_NL_API_KEY',
      'KEYWORD_EXTRACTOR',
      'MODERATION_PROVIDER',
      'REKOGNITION_ACCESS_KEY_ID',
      'REKOGNITION_SECRET_ACCESS_KEY',
    ]);
  });

  test('DISIFYはAPIサーバーとイベントサーバーの両方で無効な鍵にする', () => {
    const workers = LOCAL_OVERRIDES.filter(
      ({ service }) => service === 'disify',
    ).map(({ worker }) => worker);

    expect(workers.toSorted()).toEqual(['api', 'event']);
  });
});

describe('起動のコマンド', () => {
  const ALL = [...EXTERNAL_SERVICES];

  test('Workerごとの起動の入口(`run-with-secrets --scope local --worker`)を使い、先頭でアプリのディレクトリへ移る', () => {
    const commands = buildDegradedCommands(ALL);

    expect(commands).toHaveLength(2);
    expect(commands[0]).toStartWith(
      'cd /workspace/apps/api && bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker api -- ',
    );
    expect(commands[1]).toStartWith(
      'cd /workspace/apps/event && bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker event -- ',
    );
  });

  test('素の`infisical run`を使わない', () => {
    for (const command of buildDegradedCommands(ALL)) {
      expect(command).not.toContain('infisical');
    }
  });

  test('wranglerの引数は各アプリのdevスクリプトに合わせ、変数は`--var`で足す', () => {
    for (const { worker, command } of buildDegradedLaunches(ALL)) {
      const afterDev = command.slice(
        command.indexOf('wrangler dev') + 'wrangler dev'.length,
      );

      expect(afterDev.trim()).toStartWith(devScriptArgsOf(worker));
      expect(afterDev).toContain(' --var ');
    }
  });

  test('秘密の値を含まず、全ての鍵に当たる値が無効な固定の値である', () => {
    const text = buildDegradedCommands(ALL).join('\n');

    for (const pattern of SECRET_LIKE_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
    const credentialAssignments = [
      ...text.matchAll(/--var ([A-Z0-9_]+):(\S+)/gu),
    ].filter(([, key = '']) => CREDENTIAL_KEY_PATTERN.test(key));

    expect(credentialAssignments.length).toBeGreaterThan(0);
    for (const [, , value = ''] of credentialAssignments) {
      expect(value).toStartWith('degraded-invalid-');
    }
  });

  test('止めるサービスの差し替えだけを、Workerごとに1つの起動へまとめる', () => {
    const launches = buildDegradedLaunches(['stripe', 'email']);

    expect(launches.map(({ worker, services }) => [worker, services])).toEqual([
      ['api', ['stripe']],
      ['event', ['stripe', 'email']],
    ]);
    const [api, event] = launches;

    expect(api?.command).toContain('env -u STRIPE_API_KEY bunx wrangler dev');
    expect(api?.command).not.toContain('MAILPIT_API_URL');
    expect(event?.command).toContain('env -u STRIPE_API_KEY bunx wrangler dev');
    expect(event?.command).toContain(
      '--var MAILPIT_API_URL:http://127.0.0.1:1',
    );
  });

  test('差し替えの無いWorkerの起動は出さない', () => {
    const launches = buildDegradedLaunches(['email']);

    expect(launches.map(({ worker }) => worker)).toEqual(['event']);
  });

  test('サービスの指定の順や重複によらず、同じコマンドになる', () => {
    expect(buildDegradedCommands(['email', 'stripe', 'email'])).toEqual(
      buildDegradedCommands(['stripe', 'email']),
    );
  });

  test('変数は名前の順に並べる', () => {
    const [command = ''] = buildDegradedCommands(['rekognition']);
    const names = [...command.matchAll(/--var ([A-Z0-9_]+):/gu)].map(
      ([, name]) => name,
    );

    expect(names).toHaveLength(3);
    expect(names).toEqual(names.toSorted());
  });

  test('差し替えの手段が無いサービスだけを指定すると、コマンドを出さない', () => {
    expect(buildDegradedCommands(['hibp'])).toEqual([]);
    expect(buildDegradedCommands([])).toEqual([]);
  });
});

describe('サービス名の判定', () => {
  test.each([...EXTERNAL_SERVICES])('%sは外部サービスの名前である', (name) => {
    expect(isExternalService(name)).toBe(true);
  });

  test.each(['', 'all', 'Stripe', 'toString', '__proto__'])(
    '%sは外部サービスの名前でない',
    (name) => {
      expect(isExternalService(name)).toBe(false);
    },
  );
});
