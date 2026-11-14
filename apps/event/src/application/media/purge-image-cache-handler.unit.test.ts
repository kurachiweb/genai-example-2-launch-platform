import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { redactByField } from '@logtape/redaction';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type {
  MessageHandler,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import {
  assertRetryPolicy,
  decideOnFailure,
} from '../../../lib/core/messaging/retry-policy.ts';
import {
  REDACTED,
  REDACTED_FIELD_PATTERNS,
} from '../../../lib/core/logging/redaction.ts';
import type { PurgeImageCacheBody } from '../../../lib/core/media/media-messages.ts';
import type { ImageCachePurger, ImageCachePurgeResult } from './ports.ts';
import {
  ImageCachePurgeError,
  PURGE_IMAGE_CACHE_RETRY_POLICY,
  PurgeImageCacheHandler,
} from './purge-image-cache-handler.ts';

const OBJECT_KEYS = [
  '0123456789abcdef'.repeat(2),
  'fedcba9876543210'.repeat(2),
];

const META: MessageMeta = {
  id: 'message-1',
  type: 'media.purge-image-cache',
  attempts: 1,
  sentAt: new Date('2030-01-15T11:59:30.000Z'),
};

const records: LogRecord[] = [];

beforeAll(() => {
  configureSync({
    reset: true,
    sinks: {
      capture: redactByField((record) => records.push(record), {
        fieldPatterns: REDACTED_FIELD_PATTERNS,
        action: () => REDACTED,
      }),
    },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterAll(() => {
  resetSync();
});

beforeEach(() => {
  records.length = 0;
});

function createPurger(
  result: ImageCachePurgeResult,
): ImageCachePurger & { readonly calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    purge: (objectKeys) => {
      calls.push(objectKeys);
      return Promise.resolve(result);
    },
  };
}

function purgeLogs(): LogRecord[] {
  return records.filter(
    (record) => record.category.join('.') === 'event.media.purge',
  );
}

describe('PurgeImageCacheHandler', () => {
  test('パージの部品が受け付ければ、本文のオブジェクトキーを渡して完了する', async () => {
    const purger = createPurger({ ok: true });
    const handler: MessageHandler<PurgeImageCacheBody> =
      new PurgeImageCacheHandler(purger);

    const result = await handler.handle({ objectKeys: OBJECT_KEYS }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(purger.calls).toEqual([OBJECT_KEYS]);
  });

  test('パージした件数を、オブジェクトキーを含めず、属性名による伏せ字に当たらない名前でログへ出す', async () => {
    const handler: MessageHandler<PurgeImageCacheBody> =
      new PurgeImageCacheHandler(createPurger({ ok: true }));

    await handler.handle({ objectKeys: OBJECT_KEYS }, META);

    const logs = purgeLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.properties).toEqual({ purgedCount: 2 });
  });

  test('パージの部品が拒否すれば、間隔を伸ばして再試行させるため拒否のエラーコードを持つ例外を投げる', async () => {
    const handler: MessageHandler<PurgeImageCacheBody> =
      new PurgeImageCacheHandler(
        createPurger({ ok: false, errorCodes: [1134, 1200] }),
      );

    const caught = await handler
      .handle({ objectKeys: OBJECT_KEYS }, META)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ImageCachePurgeError);
    expect(caught).toMatchObject({ errorCodes: [1134, 1200] });
    expect((caught as Error).message).toContain('1134,1200');
    expect(purgeLogs()).toEqual([]);
  });

  test('パージの部品の例外はそのまま投げる', async () => {
    const failure = new Error('RPCの失敗');
    const handler: MessageHandler<PurgeImageCacheBody> =
      new PurgeImageCacheHandler({
        purge: () => Promise.reject(failure),
      });

    const caught = await handler
      .handle({ objectKeys: OBJECT_KEYS }, META)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});

describe('PURGE_IMAGE_CACHE_RETRY_POLICY', () => {
  test('最大5回・60秒起点で再試行し、5回目の失敗でデッドレターへ移す', () => {
    assertRetryPolicy(PURGE_IMAGE_CACHE_RETRY_POLICY);

    expect(
      [1, 2, 3, 4, 5].map((attempts) =>
        decideOnFailure(PURGE_IMAGE_CACHE_RETRY_POLICY, attempts),
      ),
    ).toEqual([
      { kind: 'retry', delaySeconds: 60 },
      { kind: 'retry', delaySeconds: 120 },
      { kind: 'retry', delaySeconds: 240 },
      { kind: 'retry', delaySeconds: 480 },
      { kind: 'dead-letter' },
    ]);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(PURGE_IMAGE_CACHE_RETRY_POLICY)).toBe(true);
  });
});
