import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/product.ts';
import type { ProductLifecycleCommitResult } from './ports.ts';
import {
  type ProductDeletion,
  StoreProductDeletion,
} from './product-deletion.ts';
import type { ProductState } from './product-state-evaluator.ts';
import {
  LOCKED,
  LOCKS_UNKNOWN,
  NEW_PLAN,
  PRODUCT_ID,
  rejectionOf,
  snapshotOf,
  stateWith,
} from './testing/product-editor-fixtures.ts';
import {
  createFakeProductStore,
  createFakeStateEvaluator,
  currentUserOf,
  fixedClock,
  type FakeProductStoreOptions,
  PRODUCT_NOW,
  USER_ID,
} from './testing/product-fakes.ts';
import {
  createFakeLifecycleCommitter,
  createFakeProductMessagePublisher,
  LIFECYCLE_EVENT_ID,
  unexpectedFailureOf,
} from './testing/product-lifecycle-fakes.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

interface DeletionSetupOptions {
  readonly store?: FakeProductStoreOptions;
  readonly state?: ProductState;
  readonly commitResult?: ProductLifecycleCommitResult;
  readonly publishError?: Error;
}

function setup(options: DeletionSetupOptions = {}) {
  const calls: string[] = [];
  const store = createFakeProductStore(calls, {
    snapshots: [snapshotOf()],
    ...options.store,
  });
  const state = options.state ?? stateWith(NEW_PLAN);
  const fakeEvaluator = createFakeStateEvaluator(calls, () => state);
  const fakeCommitter = createFakeLifecycleCommitter(
    calls,
    options.commitResult,
  );
  const fakePublisher = createFakeProductMessagePublisher(calls, {
    error: options.publishError,
  });
  const deletion: ProductDeletion = new StoreProductDeletion(
    store,
    fakeEvaluator.evaluator,
    fakeCommitter.committer,
    fakePublisher.publisher,
    fixedClock,
  );
  return {
    deletion,
    calls,
    ...fakeEvaluator,
    ...fakeCommitter,
    ...fakePublisher,
  };
}

const INPUT = { productHandle: 'launch-meter', expectedVersion: 3 } as const;

describe('ProductDeletion.delete', () => {
  test('本人のプロダクト→版→固定の判定→確定→送信の順に進め、読み取った版で削除を確定してから実行を送る', async () => {
    const { deletion, calls, requests, commands, published } = setup();

    await deletion.delete(currentUserOf(), INPUT);

    expect(calls).toEqual([
      'store.findForOwner',
      'evaluator.evaluate',
      'committer.commit',
      'publisher.publish',
    ]);
    expect(requests).toEqual([
      {
        ownerUserId: USER_ID,
        products: [
          {
            productId: PRODUCT_ID,
            hidden: false,
            launches: snapshotOf().launches,
          },
        ],
        at: PRODUCT_NOW,
      },
    ]);
    expect(commands).toEqual([
      {
        type: 'deleted',
        productId: PRODUCT_ID,
        expectedVersion: 3,
        at: PRODUCT_NOW,
      },
    ]);
    expect(published).toEqual([
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: LIFECYCLE_EVENT_ID },
      },
    ]);
  });

  test('他人・論理削除済み・旧ハンドルなど本人の現在のハンドルで見つからなければproduct_not_foundで拒否し、判定も確定もしない', async () => {
    const { deletion, calls } = setup({
      store: { snapshots: [snapshotOf({ ownerUserId: 'someone-else' })] },
    });

    const error = await rejectionOf(deletion.delete(currentUserOf(), INPUT));

    expect(error.code).toBe('product_not_found');
    expect(error.kind).toBe('not_found');
    expect(calls).toEqual(['store.findForOwner']);
  });

  test('版が違えばproduct_update_conflictで拒否し、判定も確定もしない', async () => {
    const { deletion, calls } = setup();

    const error = await rejectionOf(
      deletion.delete(currentUserOf(), { ...INPUT, expectedVersion: 2 }),
    );

    expect(error.code).toBe('product_update_conflict');
    expect(calls).toEqual(['store.findForOwner']);
  });

  test('予選・供給元の固定の期間ならproduct_lockedで拒否し、確定も送信もしない', async () => {
    const { deletion, calls } = setup({ state: stateWith(NEW_PLAN, LOCKED) });

    const error = await rejectionOf(deletion.delete(currentUserOf(), INPUT));

    expect(error.code).toBe('product_locked');
    expect(error.kind).toBe('conflict');
    expect(calls).toEqual(['store.findForOwner', 'evaluator.evaluate']);
  });

  test('固定を確認できなければdecision_unavailableで拒否し、確定も送信もしない', async () => {
    const { deletion, calls } = setup({
      state: stateWith(NEW_PLAN, LOCKS_UNKNOWN),
    });

    const error = await rejectionOf(deletion.delete(currentUserOf(), INPUT));

    expect(error.code).toBe('decision_unavailable');
    expect(error.kind).toBe('unavailable');
    expect(calls).toEqual(['store.findForOwner', 'evaluator.evaluate']);
  });

  test('固定と確認できない供給元が重なれば、固定を優先してproduct_lockedで拒否する', async () => {
    const { deletion } = setup({
      state: stateWith(NEW_PLAN, { ...LOCKED, unknown: true }),
    });

    const error = await rejectionOf(deletion.delete(currentUserOf(), INPUT));

    expect(error.code).toBe('product_locked');
  });

  test.each([
    ['not-found', 'product_not_found'],
    ['conflict', 'product_update_conflict'],
    ['locked', 'product_locked'],
    ['account-unavailable', 'account_unavailable'],
  ] as const)(
    '確定が%sで取り消されたら%sで拒否し、送信しない',
    async (reason, code) => {
      const { deletion, calls } = setup({
        commitResult: { kind: 'rejected', reason },
      });

      const error = await rejectionOf(deletion.delete(currentUserOf(), INPUT));

      expect(error.code).toBe(code);
      expect(calls).not.toContain('publisher.publish');
    },
  );

  test('削除の確定がunchangedを返すのは想定外のため、AppError以外の例外で失敗させ送信しない', async () => {
    const { deletion, calls } = setup({ commitResult: { kind: 'unchanged' } });

    const error = await unexpectedFailureOf(
      deletion.delete(currentUserOf(), INPUT),
    );

    expect(error.message).toBe(
      'プロダクトの削除の確定が想定外の結果を返しました',
    );
    expect(calls).not.toContain('publisher.publish');
  });

  test('送信に失敗しても削除は確定済みのため成功として扱い、イベントとプロダクトのIDをerrorのログに残す', async () => {
    const publishError = new Error('Queueへの送信に失敗した');
    const { deletion, published } = setup({ publishError });

    await deletion.delete(currentUserOf(), INPUT);

    expect(published).toHaveLength(1);
    const errors = records.filter((record) => record.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.category).toEqual(['api', 'application', 'product']);
    expect(errors[0]?.properties).toEqual({
      error: publishError,
      eventId: LIFECYCLE_EVENT_ID,
      productId: PRODUCT_ID,
    });
  });
});
