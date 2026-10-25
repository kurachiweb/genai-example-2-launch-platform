import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  addBusinessDays,
  buildScheduledTriggerURL,
  businessDateOf,
  isNearBusinessDayBoundary,
  type ScheduledTriggerInput,
  triggerScheduled,
} from './scheduled-trigger.ts';

type TestServer = ReturnType<typeof Bun.serve>;

interface ReceivedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly cron: string | null;
  readonly time: string | null;
}

const ORIGIN_ENV_KEYS = ['E2E_API_URL', 'E2E_EVENT_URL'] as const;

const SCHEDULED_PATH = '/cdn-cgi/local/scheduled';

const API_INPUT: ScheduledTriggerInput = {
  worker: 'api',
  businessDate: '2026-10-25',
  businessTime: '04:21',
};

interface RecordingServer {
  readonly origin: string;
  readonly received: readonly ReceivedRequest[];
}

const startedServers: TestServer[] = [];

const originOf = (server: TestServer): string =>
  `http://127.0.0.1:${String(server.port)}`;

const startServer = (status: number): RecordingServer => {
  const received: ReceivedRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      received.push({
        method: request.method,
        pathname: url.pathname,
        cron: url.searchParams.get('cron'),
        time: url.searchParams.get('time'),
      });
      return new Response(status === 200 ? 'ok' : 'exception', { status });
    },
  });
  startedServers.push(server);
  return { origin: originOf(server), received };
};

// 一度使ってから止めたポートは、待ち受けが無い(接続が拒否される)URLとして使える
const createClosedPortOrigin = async (): Promise<string> => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  const origin = originOf(server);
  await server.stop(true);
  return origin;
};

const rejectionOf = async (promise: Promise<void>): Promise<Error> => {
  const rejection: unknown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(rejection instanceof Error)) {
    throw new Error('Errorで失敗することを期待したが、失敗しなかった');
  }
  return rejection;
};

const savedOrigins = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ORIGIN_ENV_KEYS) {
    savedOrigins.set(key, process.env[key]);
    Reflect.deleteProperty(process.env, key);
  }
});

afterEach(async () => {
  for (const key of ORIGIN_ENV_KEYS) {
    const saved = savedOrigins.get(key);
    if (saved === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = saved;
    }
  }
  await Promise.all(
    startedServers.splice(0).map((server) => server.stop(true)),
  );
});

describe('buildScheduledTriggerURL', () => {
  test.each([
    {
      businessTime: '04:21',
      cron: '21 12 * * *',
      utc: '2026-10-25T12:21:00.000Z',
    },
    {
      businessTime: '23:45',
      cron: '45 7 * * *',
      utc: '2026-10-26T07:45:00.000Z',
    },
    {
      businessTime: '00:00',
      cron: '0 8 * * *',
      utc: '2026-10-25T08:00:00.000Z',
    },
  ])(
    '業務時刻$businessTimeは、cron式「$cron」と$utcのUTCのミリ秒を付けたapiのローカルの定期実行の経路になる',
    ({ businessTime, cron, utc }) => {
      const url = buildScheduledTriggerURL(
        { worker: 'api', businessDate: '2026-10-25', businessTime },
        {},
      );

      expect(url.origin).toBe('http://localhost:48042');
      expect(url.pathname).toBe(SCHEDULED_PATH);
      expect([...url.searchParams.keys()]).toEqual(['cron', 'time']);
      expect(url.searchParams.get('cron')).toBe(cron);
      expect(url.searchParams.get('time')).toBe(String(Date.parse(utc)));
    },
  );

  test('eventの既定のオリジンはhttp://localhost:48043である', () => {
    const url = buildScheduledTriggerURL({ ...API_INPUT, worker: 'event' }, {});

    expect(url.origin).toBe('http://localhost:48043');
    expect(url.pathname).toBe(SCHEDULED_PATH);
  });

  test('各Workerのオリジンを環境変数で上書きでき、他方のWorkerには影響しない', () => {
    const env = {
      E2E_API_URL: 'https://api.launch.example',
      E2E_EVENT_URL: 'https://event.launch.example',
    };

    expect(buildScheduledTriggerURL(API_INPUT, env).origin).toBe(
      'https://api.launch.example',
    );
    expect(
      buildScheduledTriggerURL({ ...API_INPUT, worker: 'event' }, env).origin,
    ).toBe('https://event.launch.example');
    expect(
      buildScheduledTriggerURL(API_INPUT, {
        E2E_EVENT_URL: 'https://event.launch.example',
      }).origin,
    ).toBe('http://localhost:48042');
  });

  test('空文字の環境変数は未設定と同じく既定のオリジンになる', () => {
    const env = { E2E_API_URL: '', E2E_EVENT_URL: '' };

    expect(buildScheduledTriggerURL(API_INPUT, env).origin).toBe(
      'http://localhost:48042',
    );
    expect(
      buildScheduledTriggerURL({ ...API_INPUT, worker: 'event' }, env).origin,
    ).toBe('http://localhost:48043');
  });

  test.each(['2026/10/25', '2026-1-05', '2026-02-30', ''])(
    '不正な業務日付「%s」は例外になる',
    (businessDate) => {
      expect(() =>
        buildScheduledTriggerURL({ ...API_INPUT, businessDate }, {}),
      ).toThrow(RangeError);
    },
  );

  test.each(['4:21', '04:21:00', '0421', '24:00', '12:60', '-1:00', ''])(
    '不正な業務時刻「%s」は例外になる',
    (businessTime) => {
      expect(() =>
        buildScheduledTriggerURL({ ...API_INPUT, businessTime }, {}),
      ).toThrow(RangeError);
    },
  );
});

describe('triggerScheduled', () => {
  test('環境変数のオリジンのローカルの定期実行の経路へ、cron式とUTCのミリ秒を付けてGETで要求する', async () => {
    const server = startServer(200);
    process.env['E2E_API_URL'] = server.origin;

    await triggerScheduled(API_INPUT);

    expect(server.received).toEqual([
      {
        method: 'GET',
        pathname: SCHEDULED_PATH,
        cron: '21 12 * * *',
        time: String(Date.parse('2026-10-25T12:21:00.000Z')),
      },
    ]);
  });

  test('eventの要求はeventのオリジンへ送る', async () => {
    const apiServer = startServer(200);
    const eventServer = startServer(200);
    process.env['E2E_API_URL'] = apiServer.origin;
    process.env['E2E_EVENT_URL'] = eventServer.origin;

    await triggerScheduled({ ...API_INPUT, worker: 'event' });

    expect(apiServer.received).toHaveLength(0);
    expect(eventServer.received).toHaveLength(1);
  });

  test('2xx以外の応答は、Worker・cron式・状態コードを含む例外になる', async () => {
    const server = startServer(500);
    process.env['E2E_API_URL'] = server.origin;

    const error = await rejectionOf(triggerScheduled(API_INPUT));

    expect(error.message).toContain('api');
    expect(error.message).toContain('21 12 * * *');
    expect(error.message).toContain('500');
  });

  test('通信の失敗は、Worker・cron式と原因を含む例外になる', async () => {
    process.env['E2E_API_URL'] = await createClosedPortOrigin();

    const error = await rejectionOf(triggerScheduled(API_INPUT));

    expect(error.message).toContain('api');
    expect(error.message).toContain('21 12 * * *');
    expect(error.cause).toBeDefined();
  });

  test('不正な入力では要求を送らずに例外になる', async () => {
    const server = startServer(200);
    process.env['E2E_API_URL'] = server.origin;

    const error = await rejectionOf(
      triggerScheduled({ ...API_INPUT, businessTime: '24:00' }),
    );

    expect(error).toBeInstanceOf(RangeError);
    expect(server.received).toHaveLength(0);
  });
});

describe('businessDateOf', () => {
  test('UTCの7:59は前日の業務日付になる', () => {
    expect(businessDateOf(new Date('2026-10-25T07:59:00.000Z'))).toBe(
      '2026-10-24',
    );
  });

  test('UTCの8:00は同じ日の業務日付になる', () => {
    expect(businessDateOf(new Date('2026-10-25T08:00:00.000Z'))).toBe(
      '2026-10-25',
    );
  });

  test('不正な時点は例外になる', () => {
    expect(() => businessDateOf(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('addBusinessDays', () => {
  test.each([
    { date: '2026-10-31', days: 1, expected: '2026-11-01' },
    { date: '2026-12-31', days: 1, expected: '2027-01-01' },
    { date: '2026-03-01', days: -1, expected: '2026-02-28' },
    { date: '2026-10-25', days: 0, expected: '2026-10-25' },
    { date: '2026-10-25', days: 10, expected: '2026-11-04' },
  ])('$dateに$days日を加えると$expectedになる', ({ date, days, expected }) => {
    expect(addBusinessDays(date, days)).toBe(expected);
  });

  test('不正な業務日付は例外になる', () => {
    expect(() => addBusinessDays('2026-02-30', 1)).toThrow(RangeError);
  });

  test.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '整数でない日数%pは例外になる',
    (days) => {
      expect(() => addBusinessDays('2026-10-25', days)).toThrow(RangeError);
    },
  );

  test('日付で表せる範囲を超える加算は例外になる', () => {
    expect(() => addBusinessDays('2026-10-25', 100_000_000)).toThrow(
      RangeError,
    );
  });
});

describe('isNearBusinessDayBoundary', () => {
  test.each([
    { utc: '2026-10-25T07:39:59.999Z', expected: false },
    { utc: '2026-10-25T07:40:00.000Z', expected: true },
    { utc: '2026-10-25T07:59:59.999Z', expected: true },
    { utc: '2026-10-25T08:00:00.000Z', expected: false },
    { utc: '2026-10-25T12:00:00.000Z', expected: false },
  ])('UTCの$utcは境界の直前か: $expected', ({ utc, expected }) => {
    expect(isNearBusinessDayBoundary(new Date(utc))).toBe(expected);
  });

  test('不正な時点は例外になる', () => {
    expect(() => isNearBusinessDayBoundary(new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
