import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/product.ts';
import type { ProductLifecycleCommitResult } from './ports.ts';
import {
  type ProductVisibilityControl,
  StoreProductVisibilityControl,
} from './product-visibility-control.ts';
import { rejectionOf } from './testing/product-editor-fixtures.ts';
import { PRODUCT_NOW } from './testing/product-fakes.ts';
import {
  createFakeLifecycleCommitter,
  createFakeProductIncidentReporter,
  createFakeProductMessagePublisher,
  LIFECYCLE_EVENT_ID,
  unexpectedFailureOf,
  LIFECYCLE_PRODUCT_ID,
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

interface VisibilitySetupOptions {
  readonly commitResult?: ProductLifecycleCommitResult;
  readonly publishError?: Error;
}

function setup(options: VisibilitySetupOptions = {}) {
  const calls: string[] = [];
  const fakeCommitter = createFakeLifecycleCommitter(
    calls,
    options.commitResult,
  );
  const fakePublisher = createFakeProductMessagePublisher(calls, {
    error: options.publishError,
  });
  const fakeReporter = createFakeProductIncidentReporter(calls);
  const control: ProductVisibilityControl = new StoreProductVisibilityControl(
    fakeCommitter.committer,
    fakePublisher.publisher,
    fakeReporter.reporter,
  );
  return {
    control,
    calls,
    ...fakeCommitter,
    ...fakePublisher,
    ...fakeReporter,
  };
}

const OPERATIONS = [
  ['hide', 'hidden'],
  ['unhide', 'unhidden'],
] as const;

describe.each(OPERATIONS)('ProductVisibilityControl.%s', (operation, type) => {
  test(`${type}を受け取った時刻で確定し、確定の後に実行を送ってchangedを返す`, async () => {
    const { control, calls, commands, published, incidents } = setup();

    const result = await control[operation](LIFECYCLE_PRODUCT_ID, PRODUCT_NOW);

    expect(result).toBe('changed');
    expect(calls).toEqual(['committer.commit', 'publisher.publish']);
    expect(commands).toEqual([
      { type, productId: LIFECYCLE_PRODUCT_ID, at: PRODUCT_NOW },
    ]);
    expect(published).toEqual([
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: LIFECYCLE_EVENT_ID },
      },
    ]);
    expect(incidents).toEqual([]);
  });

  test('既に同じ状態ならunchangedを返し、送信しない', async () => {
    const { control, calls } = setup({ commitResult: { kind: 'unchanged' } });

    const result = await control[operation](LIFECYCLE_PRODUCT_ID, PRODUCT_NOW);

    expect(result).toBe('unchanged');
    expect(calls).toEqual(['committer.commit']);
  });

  test('論理削除済み・存在しないプロダクトは404のproduct_not_foundで拒否し、送信しない', async () => {
    const { control, calls } = setup({
      commitResult: { kind: 'rejected', reason: 'not-found' },
    });

    const error = await rejectionOf(
      control[operation](LIFECYCLE_PRODUCT_ID, PRODUCT_NOW),
    );

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe('product_not_found');
    expect(error.message).toBe('プロダクトが見つかりません。');
    expect(calls).toEqual(['committer.commit']);
  });

  test.each(['conflict', 'locked', 'account-unavailable'] as const)(
    '非公開化・復元の確定が条件にしない理由%sで取り消されるのは想定外のため、AppError以外の例外で失敗させる',
    async (reason) => {
      const { control, calls } = setup({
        commitResult: { kind: 'rejected', reason },
      });

      const error = await unexpectedFailureOf(
        control[operation](LIFECYCLE_PRODUCT_ID, PRODUCT_NOW),
      );

      expect(error.message).toBe(
        'プロダクトの非公開化・復元の確定が想定外の理由で取り消されました',
      );
      expect(calls).toEqual(['committer.commit']);
    },
  );

  test('送信に失敗しても確定済みのためchangedを返し、イベントとプロダクトのIDをerrorのログに残して運用者へ通知する', async () => {
    const publishError = new Error('Queueへの送信に失敗した');
    const { control, calls, incidents } = setup({ publishError });

    const result = await control[operation](LIFECYCLE_PRODUCT_ID, PRODUCT_NOW);

    expect(result).toBe('changed');
    expect(calls).toEqual([
      'committer.commit',
      'publisher.publish',
      'reporter.report',
    ]);
    expect(incidents).toEqual([
      {
        kind: 'product-lifecycle-publish-failed',
        eventId: LIFECYCLE_EVENT_ID,
        productId: LIFECYCLE_PRODUCT_ID,
      },
    ]);
    const errors = records.filter((record) => record.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.properties).toEqual({
      error: publishError,
      eventId: LIFECYCLE_EVENT_ID,
      productId: LIFECYCLE_PRODUCT_ID,
    });
  });
});
