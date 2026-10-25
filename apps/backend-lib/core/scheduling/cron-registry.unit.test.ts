import { describe, expect, test } from 'bun:test';

import type { ServiceIdentifier } from 'inversify';

import type { BusinessTimeOfDay } from '../time/business-time.ts';
import {
  createCronRegistry,
  CronRegistryError,
  type ScheduledJobContext,
  type ScheduledJobDefinition,
  type ScheduledJobHandler,
} from './cron-registry.ts';

function handlerId(name: string): ServiceIdentifier<ScheduledJobHandler> {
  return Symbol.for(`test.${name}`);
}

function job(
  name: string,
  at: BusinessTimeOfDay,
  order: number,
): ScheduledJobDefinition {
  return { name, at, order, handler: handlerId(name) };
}

const DAILY_CLEANUP_AT = { hour: 4, minute: 21 } as const;
const RECONCILIATION_AT = { hour: 23, minute: 40 } as const;

describe('createCronRegistry', () => {
  test('同じ時刻のジョブを登録の順ではなくorderの昇順で返す', () => {
    const media = job('media-pipeline.orphan-cleanup', DAILY_CLEANUP_AT, 810);
    const identity = job('identity-auth.session-purge', DAILY_CLEANUP_AT, 100);
    const payments = job('payments.refund-sweep', DAILY_CLEANUP_AT, 400);

    const registry = createCronRegistry([media, identity, payments]);

    expect(registry.jobsFor('21 12 * * *')).toEqual([
      identity,
      payments,
      media,
    ]);
  });

  test('orderの範囲は検査せず、負の値や10000以上の値も順序どおりに並べる', () => {
    const late = job('identity-auth.lifecycle-fanout', DAILY_CLEANUP_AT, 10000);
    const early = job('example.pre-step', DAILY_CLEANUP_AT, -5);
    const zero = job('example.zero-step', DAILY_CLEANUP_AT, 0);

    const registry = createCronRegistry([late, early, zero]);

    expect(registry.jobsFor('21 12 * * *')).toEqual([early, zero, late]);
  });

  test('業務時刻をUTCのcron式に変換し、ジョブを式ごとに分ける', () => {
    const cleanup = job('identity-auth.session-purge', DAILY_CLEANUP_AT, 100);
    const reconciliation = job(
      'payments.checkout-reconciliation',
      RECONCILIATION_AT,
      10,
    );
    const matchClose = job('match-engine.close-matches', RECONCILIATION_AT, 20);

    const registry = createCronRegistry([matchClose, cleanup, reconciliation]);

    expect(registry.jobsFor('21 12 * * *')).toEqual([cleanup]);
    expect(registry.jobsFor('40 7 * * *')).toEqual([
      reconciliation,
      matchClose,
    ]);
  });

  test('cron式の一覧をUTCの起動時刻の昇順で重複なしに返す', () => {
    const registry = createCronRegistry([
      job('example.noon', { hour: 12, minute: 0 }, 1),
      job('example.cleanup-a', DAILY_CLEANUP_AT, 1),
      job('example.reconcile', RECONCILIATION_AT, 1),
      job('example.cleanup-b', DAILY_CLEANUP_AT, 2),
      job('example.morning', { hour: 8, minute: 5 }, 1),
      job('example.last', { hour: 23, minute: 45 }, 1),
    ]);

    expect(registry.cronExpressions()).toEqual([
      '40 7 * * *',
      '45 7 * * *',
      '21 12 * * *',
      '5 16 * * *',
      '0 20 * * *',
    ]);
  });

  test('業務日付の境界の0:00は8:00 UTC、16:00は0:00 UTCの式になる', () => {
    const registry = createCronRegistry([
      job('example.day-start', { hour: 0, minute: 0 }, 1),
      job('example.utc-midnight', { hour: 16, minute: 0 }, 1),
    ]);

    expect(registry.cronExpressions()).toEqual(['0 0 * * *', '0 8 * * *']);
    expect(registry.jobsFor('0 8 * * *').map(({ name }) => name)).toEqual([
      'example.day-start',
    ]);
    expect(registry.jobsFor('0 0 * * *').map(({ name }) => name)).toEqual([
      'example.utc-midnight',
    ]);
  });

  test('未登録のcron式には空の一覧を返す', () => {
    const registry = createCronRegistry([
      job('identity-auth.session-purge', DAILY_CLEANUP_AT, 100),
    ]);

    expect(registry.jobsFor('22 12 * * *')).toEqual([]);
    expect(registry.jobsFor('')).toEqual([]);
  });

  test('ジョブが1つも無ければ式の一覧もジョブも空になる', () => {
    const registry = createCronRegistry([]);

    expect(registry.cronExpressions()).toEqual([]);
    expect(registry.jobsFor('21 12 * * *')).toEqual([]);
  });

  test('返す一覧は凍結され、呼び出し側の変更が登録表に及ばない', () => {
    const definitions = [
      job('identity-auth.session-purge', DAILY_CLEANUP_AT, 100),
    ];
    const registry = createCronRegistry(definitions);

    definitions.push(job('example.added-later', DAILY_CLEANUP_AT, 200));

    expect(Object.isFrozen(registry.cronExpressions())).toBe(true);
    expect(Object.isFrozen(registry.jobsFor('21 12 * * *'))).toBe(true);
    expect(Object.isFrozen(registry.jobsFor('0 0 * * *'))).toBe(true);
    expect(registry.jobsFor('21 12 * * *')).toHaveLength(1);
  });

  test('同じ名前のジョブが2つあるとCronRegistryErrorになる', () => {
    const definitions = [
      job('payments.refund-sweep', DAILY_CLEANUP_AT, 400),
      job('payments.refund-sweep', RECONCILIATION_AT, 410),
    ];

    expect(() => createCronRegistry(definitions)).toThrow(CronRegistryError);
    expect(() => createCronRegistry(definitions)).toThrow(
      'payments.refund-sweep',
    );
  });

  test('同じ時刻で同じorderのジョブが2つあるとCronRegistryErrorになる', () => {
    const definitions = [
      job('payments.refund-sweep', DAILY_CLEANUP_AT, 400),
      job('example.colliding', { hour: 4, minute: 21 }, 400),
    ];

    expect(() => createCronRegistry(definitions)).toThrow(CronRegistryError);
    expect(() => createCronRegistry(definitions)).toThrow('400');
  });

  test('異なる時刻なら同じorderを使える', () => {
    const registry = createCronRegistry([
      job('payments.refund-sweep', DAILY_CLEANUP_AT, 10),
      job('payments.checkout-reconciliation', RECONCILIATION_AT, 10),
    ]);

    expect(registry.cronExpressions()).toEqual(['40 7 * * *', '21 12 * * *']);
  });

  test.each([
    { hour: 24, minute: 0 },
    { hour: -1, minute: 0 },
    { hour: 4, minute: 60 },
    { hour: 4, minute: -1 },
    { hour: 4.5, minute: 0 },
    { hour: 4, minute: 21.5 },
    { hour: Number.NaN, minute: 0 },
  ])('範囲外の業務時刻%pはCronRegistryErrorになる', (at) => {
    const definitions = [job('example.out-of-range', at, 1)];

    expect(() => createCronRegistry(definitions)).toThrow(CronRegistryError);
    expect(() => createCronRegistry(definitions)).toThrow(
      'example.out-of-range',
    );
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    '整数でないorder%pはCronRegistryErrorになる',
    (order) => {
      const definitions = [job('example.bad-order', DAILY_CLEANUP_AT, order)];

      expect(() => createCronRegistry(definitions)).toThrow(CronRegistryError);
    },
  );

  test('境界の0:00と23:59は受け付ける', () => {
    const registry = createCronRegistry([
      job('example.first-minute', { hour: 0, minute: 0 }, 1),
      job('example.last-minute', { hour: 23, minute: 59 }, 1),
    ]);

    expect(registry.cronExpressions()).toEqual(['59 7 * * *', '0 8 * * *']);
  });
});

describe('CronRegistryError', () => {
  test('Errorを継承し、名前と原因を持つ', () => {
    const cause = new RangeError('範囲外');
    const error = new CronRegistryError('登録の誤り', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CronRegistryError');
    expect(error.message).toBe('登録の誤り');
    expect(error.cause).toBe(cause);
  });
});

describe('ScheduledJobHandler', () => {
  test('処理は予定時刻とcron式と業務時刻の文脈を受け取る', async () => {
    const received: ScheduledJobContext[] = [];
    const handler: ScheduledJobHandler = {
      run: (context) => {
        received.push(context);
        return Promise.resolve();
      },
    };
    const context: ScheduledJobContext = {
      scheduledTime: new Date('2026-10-25T12:21:00.000Z'),
      cron: '21 12 * * *',
      business: {
        date: '2026-10-25' as ScheduledJobContext['business']['date'],
        weekday: 7,
        hour: 4,
        minute: 21,
      },
    };

    await handler.run(context);

    expect(received).toEqual([context]);
  });
});
