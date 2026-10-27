import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { getConfig, resetSync } from '@logtape/logtape';
import { DEFAULT_REDACT_FIELDS } from '@logtape/redaction';

import { REDACTED } from '../../utilities/observability/redaction-patterns.ts';
import type { FrontendLogLevel } from '../env/frontend-env.ts';
import type { IpRateLimitLogger } from '../http/ip-rate-limit.ts';
import type { RelayLogger } from '../relay/relay-route.ts';
import type { SessionCookieLogger } from '../relay/session-cookie.ts';
import {
  type AccessLogRecord,
  ensureFrontendLoggingConfigured,
  type FrontendLoggingOptions,
  getFrontendLogger,
  logAccess,
  REDACTED_FIELD_PATTERNS,
  withCorrelationId,
} from './logging.ts';

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly args: readonly unknown[];
}

interface RecordingConsole {
  readonly console: Console;
  readonly calls: readonly ConsoleCall[];
}

interface LoggedObject {
  readonly time: string;
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const createRecordingConsole = (): RecordingConsole => {
  const calls: ConsoleCall[] = [];
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]): void => {
      calls.push({ method, args });
    };
  const recorder: Pick<Console, ConsoleMethod> = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  return { console: recorder as Console, calls };
};

const configureWith = (
  level: FrontendLogLevel,
  recording: RecordingConsole = createRecordingConsole(),
  caller: FrontendLoggingOptions['caller'] = 'client',
): RecordingConsole => {
  ensureFrontendLoggingConfigured({
    caller,
    level,
    console: recording.console,
  });
  return recording;
};

const loggedObjects = (recording: RecordingConsole): LoggedObject[] =>
  recording.calls.map(({ args }) => {
    expect(args).toHaveLength(1);
    return args[0] as LoggedObject;
  });

const withoutTime = (logged: LoggedObject): Record<string, unknown> =>
  Object.fromEntries(Object.entries(logged).filter(([key]) => key !== 'time'));

// スタックは実行環境ごとに異なるため、文字列であることだけを確かめて取り除く
const withoutStacks = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const { stack, ...rest } = value as Record<string, unknown>;
  expect(typeof stack).toBe('string');
  return Object.fromEntries(
    Object.entries(rest).map(([key, item]) => [
      key,
      key === 'cause' ? withoutStacks(item) : item,
    ]),
  );
};

const pick = (
  logged: LoggedObject | undefined,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(keys.map((key) => [key, logged?.[key]]));

const logger = getFrontendLogger(['client', 'application', 'logging-test']);

const CLIENT_IPV4 = '203.0.113.10';
const CLIENT_IPV6 = '2001:db8::1';
const EMAIL_ADDRESS = 'user@launch.example';
// シークレット検出が実物のトークンと誤検知しないよう、テスト用の値を部品から組み立てる
const TOKEN_VALUE = ['t', 'session', 'value'].join('-');
const COOKIE_VALUE = ['cookie', 'session', 'value'].join('-');
const QUERY_VALUE = ['query', 'secret', 'value'].join('-');
const JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIwMUpCWCJ9',
  'c2lnbmF0dXJlLXZhbHVlXy0',
].join('.');
const BEARER_VALUE = ['bearer', 'credential', 'value'].join('-');

afterAll(() => {
  resetSync();
});

describe('REDACTED_FIELD_PATTERNS', () => {
  const isRedactedField = (field: string): boolean =>
    REDACTED_FIELD_PATTERNS.some((pattern) =>
      typeof pattern === 'string' ? pattern === field : pattern.test(field),
    );

  test('@logtape/redactionの既定のパターンをすべて含み、凍結されている', () => {
    for (const pattern of DEFAULT_REDACT_FIELDS) {
      expect(REDACTED_FIELD_PATTERNS).toContain(pattern);
    }
    expect(Object.isFrozen(REDACTED_FIELD_PATTERNS)).toBe(true);
  });

  test.each([
    'ip',
    'ipAddress',
    'clientIp',
    'remoteIp',
    'IP',
    'email',
    'mail',
    'cookie',
    'Cookie',
    'set-cookie',
    'cookies',
    'authorization',
    'Authorization',
    'token',
    'sessionToken',
    'turnstileToken',
    'pepper',
    'secret',
  ])('%sの属性を伏せる', (field) => {
    expect(isRedactedField(field)).toBe(true);
  });

  test.each([
    'method',
    'path',
    'status',
    'durationMs',
    'correlationId',
    'outcome',
    'reason',
    'route',
    'code',
    'invalidEnvNames',
  ])('%sの属性は伏せない', (field) => {
    expect(isRedactedField(field)).toBe(false);
  });
});

describe('ensureFrontendLoggingConfigured', () => {
  test('backend-platformと同じ形式のJSONのオブジェクトを、文字列にせずレベルに対応するコンソールのメソッドへ渡す', () => {
    const recording = configureWith('debug');

    logger.debug('詳細を記録しました', { step: 1 });
    logger.info('{count}件を処理しました', { count: 3, items: ['a', 'b'] });
    logger.warn('警告です');
    logger.error('失敗しました');

    const objects = loggedObjects(recording);
    expect(recording.calls.map(({ method }) => method)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
    ]);
    for (const { time } of objects) {
      expect(time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(objects.map(withoutTime)).toEqual([
      {
        level: 'debug',
        category: 'client.application.logging-test',
        message: '詳細を記録しました',
        step: 1,
      },
      {
        level: 'info',
        category: 'client.application.logging-test',
        message: '3件を処理しました',
        count: 3,
        items: ['a', 'b'],
      },
      {
        level: 'warning',
        category: 'client.application.logging-test',
        message: '警告です',
      },
      {
        level: 'error',
        category: 'client.application.logging-test',
        message: '失敗しました',
      },
    ]);
  });

  test('基本の4項目と同名の属性があっても基本の項目の値を保つ', () => {
    const recording = configureWith('info');

    logger.info('処理しました', {
      level: 'fatal',
      category: 'forged',
      message: 'forged',
      time: 'forged',
    });

    const [logged] = loggedObjects(recording);
    expect(logged).toMatchObject({
      level: 'info',
      category: 'client.application.logging-test',
      message: '処理しました',
    });
    expect(logged?.time).not.toBe('forged');
  });

  test('差し込み値はオブジェクトをJSONに、Errorとnullを文字列に、JSONにできない値を型の表記にして埋め込む', () => {
    const recording = configureWith('info');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const strings = ['値は', '・', '・', '・', 'です'];
    const template: TemplateStringsArray = Object.assign([...strings], {
      raw: strings,
    });

    logger.info(template, { count: 1 }, new Error('失敗'), null, circular);

    expect(loggedObjects(recording)[0]?.message).toBe(
      '値は{"count":1}・Error: 失敗・null・[object Object]です',
    );
  });

  test('最上位の例外を名前・メッセージ・スタック・原因のオブジェクトに開き、独自のプロパティとオブジェクトの原因を出さない', () => {
    const recording = configureWith('info');
    const root = new Error('根本の原因');
    const error = Object.assign(
      new TypeError('処理に失敗しました', { cause: root }),
      { detail: { token: TOKEN_VALUE } },
    );
    const objectCause = new Error('外側', { cause: { token: TOKEN_VALUE } });

    logger.error('例外が起きました', { error, objectCause });

    const [logged] = loggedObjects(recording);
    expect(withoutStacks(logged?.['error'])).toEqual({
      name: 'TypeError',
      message: '処理に失敗しました',
      cause: { name: 'Error', message: '根本の原因' },
    });
    expect(withoutStacks(logged?.['objectCause'])).toEqual({
      name: 'Error',
      message: '外側',
    });
    expect(JSON.stringify(recording.calls)).not.toContain(TOKEN_VALUE);
  });

  test('循環する例外の原因は循環した先を出さず、文字列・数値・真偽値の原因はそのまま出す', () => {
    const recording = configureWith('info');
    const first = new Error('1つ目');
    const second = new Error('2つ目', { cause: first });
    first.cause = second;

    logger.error('循環しました', {
      error: first,
      textCause: new Error('文字列', { cause: '理由' }),
      numberCause: new Error('数値', { cause: 404 }),
      booleanCause: new Error('真偽値', { cause: false }),
    });

    const [logged] = loggedObjects(recording);
    expect(withoutStacks(logged?.['error'])).toEqual({
      name: 'Error',
      message: '1つ目',
      cause: { name: 'Error', message: '2つ目' },
    });
    expect(
      ['textCause', 'numberCause', 'booleanCause'].map(
        (key) => (withoutStacks(logged?.[key]) as { cause: unknown }).cause,
      ),
    ).toEqual(['理由', 404, false]);
  });

  test('IPアドレス・メールアドレス・トークン・Cookieの属性を、入れ子とメッセージの差し込みも含めて伏せる', () => {
    const recording = configureWith('info');

    logger.info('{ip}からの要求です', {
      ip: CLIENT_IPV4,
      clientIp: CLIENT_IPV4,
      email: EMAIL_ADDRESS,
      token: TOKEN_VALUE,
      sessionToken: TOKEN_VALUE,
      turnstileToken: TOKEN_VALUE,
      authorization: `Bearer ${BEARER_VALUE}`,
      headers: {
        cookie: `__Host-session=${COOKIE_VALUE}`,
        'set-cookie': `__Host-session=${COOKIE_VALUE}; Path=/`,
        accept: 'text/html',
      },
      path: '/items',
    });

    const [logged] = loggedObjects(recording);
    expect(logged).toMatchObject({
      message: `${REDACTED}からの要求です`,
      ip: REDACTED,
      clientIp: REDACTED,
      email: REDACTED,
      token: REDACTED,
      sessionToken: REDACTED,
      turnstileToken: REDACTED,
      authorization: REDACTED,
      headers: {
        cookie: REDACTED,
        'set-cookie': REDACTED,
        accept: 'text/html',
      },
      path: '/items',
    });
    const serialized = JSON.stringify(recording.calls);
    for (const secret of [
      CLIENT_IPV4,
      EMAIL_ADDRESS,
      TOKEN_VALUE,
      COOKIE_VALUE,
      BEARER_VALUE,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test('伏せない名前の属性とメッセージでも、IPアドレス・メールアドレス・JWT・Bearerの値を伏せる', () => {
    const recording = configureWith('info');

    logger.info(`${CLIENT_IPV6}と${CLIENT_IPV4}から受けました`, {
      note: `連絡先は ${EMAIL_ADDRESS} です`,
      detail: { nested: [`Bearer ${BEARER_VALUE}`, JWT] },
      failure: new Error(`${CLIENT_IPV4}への接続に失敗しました`),
    });

    const [logged] = loggedObjects(recording);
    expect(logged).toMatchObject({
      message: `${REDACTED}と${REDACTED}から受けました`,
      note: `連絡先は ${REDACTED} です`,
      detail: { nested: [REDACTED, REDACTED] },
      failure: { message: `${REDACTED}への接続に失敗しました` },
    });
    const serialized = JSON.stringify(recording.calls);
    for (const secret of [
      CLIENT_IPV4,
      CLIENT_IPV6,
      EMAIL_ADDRESS,
      BEARER_VALUE,
      JWT,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test('設定したレベルより低いログを出さない', () => {
    const recording = configureWith('warning');

    logger.debug('詳細');
    logger.info('情報');
    logger.warn('警告');
    logger.error('エラー');

    expect(loggedObjects(recording).map(({ level }) => level)).toEqual([
      'warning',
      'error',
    ]);
  });

  test('不正なレベルはinfoとして設定する', () => {
    const recording = configureWith('verbose' as FrontendLogLevel);
    const invalidConfig = getConfig();

    logger.debug('出ない');
    logger.info('出る');
    configureWith('info', recording);

    expect(loggedObjects(recording).map(({ message }) => message)).toEqual([
      '出る',
    ]);
    expect(getConfig()).toBe(invalidConfig);
  });

  test('同じ設定での2回目以降の呼び出しでは設定し直さない', () => {
    const recording = configureWith('info');
    const first = getConfig();

    configureWith('info', recording);
    logger.info('1回だけ出る');

    expect(getConfig()).toBe(first);
    expect(recording.calls).toHaveLength(1);
  });

  test('レベル・呼び出し元・出力先が変わったときだけ設定し直す', () => {
    const recording = configureWith('info');
    const infoConfig = getConfig();

    configureWith('debug', recording);
    const debugConfig = getConfig();
    configureWith('debug', recording, 'admin');
    const adminConfig = getConfig();
    const other = configureWith('debug', createRecordingConsole(), 'admin');
    const otherConsoleConfig = getConfig();

    expect(debugConfig).not.toBe(infoConfig);
    expect(adminConfig).not.toBe(debugConfig);
    expect(otherConsoleConfig).not.toBe(adminConfig);
    getFrontendLogger(['admin', 'application', 'logging-test']).info('出力');
    expect(other.calls).toHaveLength(1);
    expect(recording.calls).toEqual([]);
  });

  test('他の設定で上書きされた後の呼び出しでは設定し直す', () => {
    const recording = configureWith('info');
    resetSync();

    configureWith('info', recording);
    logger.info('設定し直した後に出る');

    expect(recording.calls).toHaveLength(1);
  });

  test('呼び出し元の名前で始まるカテゴリだけを出し、他の呼び出し元のログを捨てる', () => {
    const recording = configureWith('debug');

    getFrontendLogger(['admin', 'application', 'logging-test']).error(
      '管理者側',
    );
    getFrontendLogger(['client', 'http', 'csrf']).warn('利用者側');

    expect(loggedObjects(recording).map(({ category }) => category)).toEqual([
      'client.http.csrf',
    ]);
  });

  test('出力先はコンソールだけで、LogTape自身の設定完了の通知を出さない', () => {
    const recording = configureWith('debug');

    const config = getConfig();

    expect(Object.keys(config?.sinks ?? {})).toHaveLength(1);
    expect(recording.calls).toEqual([]);
  });

  test('出力先を指定しなければグローバルのconsoleへJSONのオブジェクトを出す', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      ensureFrontendLoggingConfigured({ caller: 'admin', level: 'info' });
      getFrontendLogger(['admin', 'application', 'logging-test']).info(
        '既定の出力',
      );

      expect(info).toHaveBeenCalledTimes(1);
      const args: readonly unknown[] = info.mock.calls[0] ?? [];
      expect(args).toHaveLength(1);
      expect(pick(args[0] as LoggedObject, ['category', 'message'])).toEqual({
        category: 'admin.application.logging-test',
        message: '既定の出力',
      });
    } finally {
      info.mockRestore();
    }
  });
});

describe('withCorrelationId', () => {
  test('処理の中のログに、非同期の処理をまたいで相関IDを付け、コールバックの戻り値を返す', async () => {
    const recording = configureWith('info');

    const result = await withCorrelationId('correlation-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.info('処理しました');
      return 'done';
    });
    logger.info('処理の外です');

    expect(result).toBe('done');
    expect(
      loggedObjects(recording).map(({ message, correlationId }) => [
        message,
        correlationId,
      ]),
    ).toEqual([
      ['処理しました', 'correlation-1'],
      ['処理の外です', undefined],
    ]);
  });

  test('同時に進む処理はそれぞれの相関IDを持つ', async () => {
    const recording = configureWith('info');

    await Promise.all(
      ['correlation-a', 'correlation-b'].map((correlationId, index) =>
        withCorrelationId(correlationId, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2 - index));
          logger.info('処理しました', { index });
        }),
      ),
    );

    expect(
      loggedObjects(recording)
        .map(({ index, correlationId }) => [index, correlationId])
        .toSorted(),
    ).toEqual([
      [0, 'correlation-a'],
      [1, 'correlation-b'],
    ]);
  });

  test('処理の途中でレベルが変わって設定し直しても、その後のログに相関IDが残る', async () => {
    const recording = configureWith('info');

    await withCorrelationId('correlation-reconfigured', async () => {
      configureWith('debug', recording);
      await Promise.resolve();
      logger.debug('設定し直した後');
    });

    expect(
      loggedObjects(recording).map((logged) =>
        pick(logged, ['message', 'correlationId']),
      ),
    ).toEqual([
      { message: '設定し直した後', correlationId: 'correlation-reconfigured' },
    ]);
  });
});

describe('getFrontendLogger', () => {
  test('IP制限・中継・Cookieの指示の警告の出力先として、そのまま渡せる', () => {
    const recording = configureWith('info');
    const rateLimitLogger: IpRateLimitLogger = getFrontendLogger([
      'client',
      'http',
      'rate-limit',
    ]);
    const relayLogger: RelayLogger = getFrontendLogger(['client', 'relay']);
    const sessionLogger: SessionCookieLogger = getFrontendLogger([
      'client',
      'relay',
      'session',
    ]);

    rateLimitLogger.warn('IP制限の判定に失敗しました', {
      error: new Error('失敗'),
    });
    relayLogger.warn('中継に失敗しました', {
      code: 'upstream_timeout',
      route: '/_bff/graphql',
    });
    sessionLogger.warn('Cookieの指示を捨てました', { reason: 'invalid_token' });

    expect(
      loggedObjects(recording).map(({ level, category }) => [level, category]),
    ).toEqual([
      ['warning', 'client.http.rate-limit'],
      ['warning', 'client.relay'],
      ['warning', 'client.relay.session'],
    ]);
  });
});

describe('logAccess', () => {
  const record: AccessLogRecord = {
    method: 'POST',
    path: '/_bff/graphql',
    status: 200,
    durationMs: 12,
    correlationId: 'correlation-access',
    outcome: 'relay',
  };

  test('呼び出し元のhttp.accessのカテゴリへ、メソッド・経路・状態コード・処理時間・相関ID・結果だけを持つinfoのログを出す', () => {
    const accessRecording = configureWith('info');

    logAccess('client', record);

    expect(accessRecording.calls.map(({ method }) => method)).toEqual(['info']);
    expect(loggedObjects(accessRecording).map(withoutTime)).toEqual([
      {
        level: 'info',
        category: 'client.http.access',
        message: 'HTTPリクエストを処理しました',
        method: 'POST',
        path: '/_bff/graphql',
        status: 200,
        durationMs: 12,
        correlationId: 'correlation-access',
        outcome: 'relay',
      },
    ]);
  });

  test.each([
    ['page', 200],
    ['rejected', 403],
    ['static_error', 500],
  ] as const)('結果%sと状態コード%iをそのまま出す', (outcome, status) => {
    const recording = configureWith('info', createRecordingConsole(), 'admin');

    logAccess('admin', { ...record, outcome, status });

    expect(
      loggedObjects(recording).map((logged) =>
        pick(logged, ['category', 'outcome', 'status']),
      ),
    ).toEqual([{ category: 'admin.http.access', outcome, status }]);
  });

  test('経路にクエリやフラグメントが含まれていても取り除き、クエリ・Cookie・IPの値を出さない', async () => {
    const recording = configureWith('info');

    await withCorrelationId('correlation-access', async () => {
      await Promise.resolve();
      logAccess('client', {
        ...record,
        method: 'GET',
        path: `/items/${CLIENT_IPV4}?token=${QUERY_VALUE}&mail=${EMAIL_ADDRESS}#${COOKIE_VALUE}`,
        outcome: 'page',
      });
      logAccess('client', {
        ...record,
        method: 'GET',
        path: `/search#${COOKIE_VALUE}?q=${QUERY_VALUE}`,
        outcome: 'page',
      });
    });

    expect(loggedObjects(recording).map(({ path }) => path)).toEqual([
      `/items/${REDACTED}`,
      '/search',
    ]);
    const serialized = JSON.stringify(recording.calls);
    for (const secret of [
      QUERY_VALUE,
      EMAIL_ADDRESS,
      COOKIE_VALUE,
      CLIENT_IPV4,
      '?',
      '#',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
