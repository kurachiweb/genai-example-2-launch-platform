import { env, exports } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import {
  afterEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';
import { z } from 'zod';

import type { AppModule } from '../lib/core/di/app-module.ts';
import { createUlidGenerator } from '../lib/core/ids/id-generator.ts';
import {
  defineMessageContract,
  type MessageHandler,
  type MessageHandlerRegistration,
} from '../lib/core/messaging/message-contract.ts';
import { systemClock } from '../lib/core/time/clock.ts';
import {
  DEFAULT_CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
} from '../lib/workers/http/security-headers.ts';
import { createMessagePublisher } from '../lib/workers/messaging/queue-publisher.ts';

// エントリが読み込む登録箇所に、テスト用の契約とハンドラーを追記した状態にする。エントリはテストからの最初の呼び出しで読み込まれるため、その時点で下の定数を参照できる
vi.mock('./composition/message-handlers.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./composition/message-handlers.ts')>();
  return {
    get MESSAGE_HANDLERS() {
      return [...original.MESSAGE_HANDLERS, ALWAYS_FAILING_REGISTRATION];
    },
  };
});
vi.mock('./composition/modules.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./composition/modules.ts')>();
  return {
    get MODULES() {
      return [...original.MODULES, ALWAYS_FAILING_MODULE];
    },
  };
});

const EVENT_ORIGIN = 'https://event.launch.example';
const IP_LIMIT = 100;
const PERIOD_MILLISECONDS = 10_000;
const BURST_MARGIN_MILLISECONDS = 4_000;
const BURST_TEST_TIMEOUT_MILLISECONDS = 30_000;
const QUEUE_ROUTE_TIMEOUT_MILLISECONDS = 30_000;
const QUEUE_ROUTE_WAIT_MILLISECONDS = 25_000;
const BODY_MARKER = 'body-marker-that-must-not-leak';
const MAX_ATTEMPTS = 2;

class AlwaysFailingHandlerError extends Error {
  override readonly name = 'AlwaysFailingHandlerError';
}

const alwaysFailingContract = defineMessageContract(
  'test.fail-always',
  z.object({ marker: z.string().min(1) }),
);

type AlwaysFailingBody = z.infer<typeof alwaysFailingContract.schema>;

const TEST_TYPES = Object.freeze({
  AlwaysFailingHandler: Symbol.for('test.AlwaysFailingHandler'),
});

const handledAttempts = new Map<string, number[]>();

const ALWAYS_FAILING_MODULE: AppModule = {
  name: 'test-always-failing',
  bindings: new ContainerModule(({ bind }) => {
    bind<MessageHandler<AlwaysFailingBody>>(
      TEST_TYPES.AlwaysFailingHandler,
    ).toConstantValue({
      handle: (_body, meta) => {
        handledAttempts.set(meta.id, [
          ...(handledAttempts.get(meta.id) ?? []),
          meta.attempts,
        ]);
        return Promise.reject(
          new AlwaysFailingHandlerError('テスト用のハンドラーは常に失敗する'),
        );
      },
    });
  }),
};

// 再試行の間隔を0秒にし、上限を本体のconsumerのmax_retriesより小さくして、Queuesの自動の移送ではなくディスパッチャの判定でデッドレターへ送らせる
const ALWAYS_FAILING_REGISTRATION: MessageHandlerRegistration<AlwaysFailingBody> =
  {
    contract: alwaysFailingContract,
    handler: TEST_TYPES.AlwaysFailingHandler,
    retry: { maxAttempts: MAX_ATTEMPTS, baseDelaySeconds: 0 },
  };

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

function fromIp(ip: string): RequestInit {
  return { headers: { 'CF-Connecting-IP': ip } };
}

// Miniflareのバインディングは壁時計にそろえた10秒の期間で数えるため、連続した要求が期間の切り替わりをまたがないように待つ
async function waitForFreshWindow(): Promise<void> {
  const remaining = PERIOD_MILLISECONDS - (Date.now() % PERIOD_MILLISECONDS);
  if (remaining < BURST_MARGIN_MILLISECONDS) {
    await scheduler.wait(remaining + 100);
  }
}

function loggedObjects(spy: MockInstance<Console['info']>): LoggedObject[] {
  return spy.mock.calls.map(([object]) => object as LoggedObject);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('イベントサーバーのエントリ', () => {
  test('ヘルスチェックは認証なしで200・no-store・状態だけを返す', async () => {
    const response = await exports.default.fetch(
      `${EVENT_ORIGIN}/health`,
      fromIp('203.0.113.10'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual({ status: 'ok' });
  });

  test('未登録の経路は404の共通のエラー形式になる', async () => {
    const response = await exports.default.fetch(
      `${EVENT_ORIGIN}/unknown-route`,
      fromIp('203.0.113.11'),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_found' },
    });
  });

  test.each<[string, string, string]>([
    ['ヘルスチェック', '/health', '203.0.113.12'],
    ['未登録の経路', '/unknown-route', '203.0.113.13'],
  ])('%sの応答にセキュリティヘッダーが付く', async (_route, path, ip) => {
    const response = await exports.default.fetch(
      `${EVENT_ORIGIN}${path}`,
      fromIp(ip),
    );
    await response.body?.cancel();

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get('Content-Security-Policy')).toBe(
      DEFAULT_CONTENT_SECURITY_POLICY,
    );
  });

  test(
    '同じIPからの101回目は429・Retry-After: 10になり、別のIPは影響を受けない',
    async () => {
      await waitForFreshWindow();
      const statuses: number[] = [];
      let limited: Response | undefined;
      for (let index = 0; index <= IP_LIMIT; index += 1) {
        const response = await exports.default.fetch(
          `${EVENT_ORIGIN}/health`,
          fromIp('203.0.113.20'),
        );
        statuses.push(response.status);
        if (index < IP_LIMIT) {
          await response.body?.cancel();
        } else {
          limited = response;
        }
      }
      const otherIp = await exports.default.fetch(
        `${EVENT_ORIGIN}/health`,
        fromIp('203.0.113.21'),
      );

      expect(
        statuses.slice(0, IP_LIMIT).every((status) => status === 200),
      ).toBe(true);
      expect(limited?.status).toBe(429);
      expect(limited?.headers.get('Retry-After')).toBe('10');
      expect(await limited?.json()).toMatchObject({
        error: { code: 'rate_limit_exceeded' },
      });
      expect(otherIp.status).toBe(200);
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '本体Queueへ送ったメッセージは、処理の失敗が上限に達するとデッドレターのconsumerで本文を含めずに通知される',
    async () => {
      const silence = (): void => undefined;
      const plainLog = vi.spyOn(console, 'log').mockImplementation(silence);
      const debugLog = vi.spyOn(console, 'debug').mockImplementation(silence);
      const infoLog = vi.spyOn(console, 'info').mockImplementation(silence);
      const warnLog = vi.spyOn(console, 'warn').mockImplementation(silence);
      const errorLog = vi.spyOn(console, 'error').mockImplementation(silence);
      const publisher = createMessagePublisher(
        env.JOBS_QUEUE,
        [alwaysFailingContract],
        createUlidGenerator(systemClock),
        systemClock,
      );

      const messageId = await publisher.publish(alwaysFailingContract, {
        marker: BODY_MARKER,
      });

      const deadLetterReport = await vi.waitFor(
        () => {
          const report = loggedObjects(errorLog).find(
            (object) =>
              object.category === 'event.queue.dead-letter' &&
              object['messageId'] === messageId,
          );
          if (report === undefined) {
            throw new Error('デッドレターのconsumerの通知がまだ出ていない');
          }
          return report;
        },
        { timeout: QUEUE_ROUTE_WAIT_MILLISECONDS, interval: 200 },
      );

      expect(deadLetterReport).toMatchObject({
        level: 'error',
        correlationId: messageId,
        messageType: alwaysFailingContract.type,
        attempts: MAX_ATTEMPTS,
        reason: 'handler-failed',
        errorName: 'AlwaysFailingHandlerError',
      });
      expect(handledAttempts.get(messageId)).toStrictEqual([1, MAX_ATTEMPTS]);
      expect(
        loggedObjects(infoLog)
          .filter(
            (object) =>
              object.category === 'event.queue.consumer' &&
              object.correlationId === messageId,
          )
          .map((object) => object['result']),
      ).toStrictEqual(['retried', 'dead-lettered']);
      // LogTapeはtrace・debugをconsole.debugへ出すため、ローカルのLOG_LEVEL(debug)で出る全ての出力先の全ての引数を確かめる
      const allOutputs = [plainLog, debugLog, infoLog, warnLog, errorLog].map(
        (spy) => spy.mock.calls,
      );
      expect(allOutputs.flat().length).toBeGreaterThan(0);
      expect(JSON.stringify(allOutputs)).not.toContain(BODY_MARKER);
    },
    QUEUE_ROUTE_TIMEOUT_MILLISECONDS,
  );
});
