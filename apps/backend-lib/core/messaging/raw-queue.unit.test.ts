import { describe, expect, test } from 'bun:test';

import {
  assertRawQueueRegistrations,
  type RawQueueRegistration,
  RawQueueRegistrationError,
  toRawMessageType,
} from './raw-queue.ts';

interface TestEnv {
  readonly EVENTS_QUEUE_NAME: string;
  readonly AUDIT_QUEUE_NAME: string;
  readonly JOBS_QUEUE_NAME: string;
  readonly JOBS_DLQ_NAME: string;
}

const TEST_ENV: TestEnv = {
  EVENTS_QUEUE_NAME: 'example-events-test',
  AUDIT_QUEUE_NAME: 'example-audit-test',
  JOBS_QUEUE_NAME: 'example-jobs-test',
  JOBS_DLQ_NAME: 'example-jobs-dlq-test',
};

const RESERVED = [TEST_ENV.JOBS_QUEUE_NAME, TEST_ENV.JOBS_DLQ_NAME] as const;

function registrationOf(
  name: string,
  queueName: (env: TestEnv) => string,
): RawQueueRegistration<TestEnv> {
  return {
    name,
    queueName,
    handler: Symbol.for(`test.${name}`),
  };
}

const eventsRegistration = registrationOf(
  'delivery-events',
  (env) => env.EVENTS_QUEUE_NAME,
);
const auditRegistration = registrationOf(
  'audit-log2',
  (env) => env.AUDIT_QUEUE_NAME,
);

function captureError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('assertRawQueueRegistrations', () => {
  test('登録が0件なら例外にしない', () => {
    expect(() => {
      assertRawQueueRegistrations([], RESERVED, TEST_ENV);
    }).not.toThrow();
  });

  test('名前とQueue名が重複しない登録を受け付ける', () => {
    expect(() => {
      assertRawQueueRegistrations(
        [eventsRegistration, auditRegistration],
        RESERVED,
        TEST_ENV,
      );
    }).not.toThrow();
  });

  test.each([
    '',
    'Delivery-events',
    'delivery_events',
    '-events',
    'events-',
    'a--b',
    '1events',
    'raw:events',
  ])('小文字英数字をハイフンでつないだ形でない名前%pを拒否する', (name) => {
    const error = captureError(() => {
      assertRawQueueRegistrations(
        [registrationOf(name, (env) => env.EVENTS_QUEUE_NAME)],
        RESERVED,
        TEST_ENV,
      );
    });

    expect(error).toBeInstanceOf(RawQueueRegistrationError);
  });

  test('同じ名前の登録を拒否する', () => {
    const error = captureError(() => {
      assertRawQueueRegistrations(
        [
          eventsRegistration,
          registrationOf('delivery-events', (env) => env.AUDIT_QUEUE_NAME),
        ],
        RESERVED,
        TEST_ENV,
      );
    });

    expect(error).toBeInstanceOf(RawQueueRegistrationError);
    expect((error as Error).message).toContain('delivery-events');
  });

  test('同じQueue名を解決する登録を拒否する', () => {
    const error = captureError(() => {
      assertRawQueueRegistrations(
        [
          eventsRegistration,
          registrationOf('other-events', (env) => env.EVENTS_QUEUE_NAME),
        ],
        RESERVED,
        TEST_ENV,
      );
    });

    expect(error).toBeInstanceOf(RawQueueRegistrationError);
    expect((error as Error).message).toContain(TEST_ENV.EVENTS_QUEUE_NAME);
  });

  test.each([
    ['本体', (env: TestEnv) => env.JOBS_QUEUE_NAME],
    ['デッドレター', (env: TestEnv) => env.JOBS_DLQ_NAME],
  ] as const)(
    '%sと同じQueue名を解決する登録を拒否する',
    (_label, queueName) => {
      const error = captureError(() => {
        assertRawQueueRegistrations(
          [registrationOf('delivery-events', queueName)],
          RESERVED,
          TEST_ENV,
        );
      });

      expect(error).toBeInstanceOf(RawQueueRegistrationError);
      expect((error as Error).message).toContain(queueName(TEST_ENV));
    },
  );

  test.each([
    ['空文字', ''],
    ['未定義', undefined],
  ] as const)('Queue名が%sに解決される登録を拒否する', (_label, resolved) => {
    const error = captureError(() => {
      assertRawQueueRegistrations(
        [
          registrationOf(
            'delivery-events',
            () => resolved as unknown as string,
          ),
        ],
        RESERVED,
        TEST_ENV,
      );
    });

    expect(error).toBeInstanceOf(RawQueueRegistrationError);
    expect((error as Error).message).toContain('delivery-events');
  });

  test('例外の名前は登録の誤りを示すクラス名になる', () => {
    const error = captureError(() => {
      assertRawQueueRegistrations(
        [eventsRegistration, eventsRegistration],
        RESERVED,
        TEST_ENV,
      );
    });

    expect((error as Error).name).toBe('RawQueueRegistrationError');
  });
});

describe('toRawMessageType', () => {
  test('登録の名前に接頭辞raw:を付けた種別を返す', () => {
    expect(toRawMessageType('delivery-events')).toBe('raw:delivery-events');
  });
});
