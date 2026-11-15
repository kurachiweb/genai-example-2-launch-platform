import { describe, expect, expectTypeOf, test } from 'bun:test';

import type { ServiceIdentifier } from 'inversify';

import {
  type LifecycleHandlerOutcome,
  LifecycleRegistrationError,
} from '../identity/user-lifecycle.ts';
import {
  assertRetryPolicy,
  decideOnFailure,
} from '../messaging/retry-policy.ts';
import {
  createProductLifecycleRegistry,
  PRODUCT_LIFECYCLE_HANDLER_LABEL,
  PRODUCT_LIFECYCLE_EVENT_STATUSES,
  PRODUCT_LIFECYCLE_EVENT_TYPES,
  PRODUCT_LIFECYCLE_RETRY_POLICY,
  type ProductLifecycleAsyncHandler,
  type ProductLifecycleAsyncRegistration,
  type ProductLifecycleEvent,
  type ProductLifecycleEventStatus,
  type ProductLifecycleEventType,
  type SyncProductLifecycleEventType,
} from './product-lifecycle.ts';

function handlerId(
  name: string,
): ServiceIdentifier<ProductLifecycleAsyncHandler> {
  return Symbol.for(`test.${name}`);
}

function registration(
  name: string,
  events: readonly ProductLifecycleEventType[],
  order: number,
): ProductLifecycleAsyncRegistration {
  return { name, events, order, handler: handlerId(name) };
}

describe('PRODUCT_LIFECYCLE_EVENT_TYPES', () => {
  test('論理削除・非公開化・復元・物理削除の時期の到来の4種類をこの順で持ち、変更できない', () => {
    expect([...PRODUCT_LIFECYCLE_EVENT_TYPES]).toEqual([
      'deleted',
      'hidden',
      'unhidden',
      'purge_due',
    ]);
    expect(Object.isFrozen(PRODUCT_LIFECYCLE_EVENT_TYPES)).toBe(true);
  });

  test('同期の処理の種類は物理削除の時期の到来を除いた3種類である', () => {
    expectTypeOf<SyncProductLifecycleEventType>().toEqualTypeOf<
      'deleted' | 'hidden' | 'unhidden'
    >();
  });
});

describe('PRODUCT_LIFECYCLE_EVENT_STATUSES', () => {
  test('イベントの状態は未完了と完了の2つで、変更できない', () => {
    expect([...PRODUCT_LIFECYCLE_EVENT_STATUSES]).toEqual([
      'pending',
      'completed',
    ]);
    expect(Object.isFrozen(PRODUCT_LIFECYCLE_EVENT_STATUSES)).toBe(true);
    expectTypeOf<ProductLifecycleEventStatus>().toEqualTypeOf<
      'pending' | 'completed'
    >();
  });
});

describe('ProductLifecycleAsyncHandler', () => {
  test('処理の結果はユーザーライフサイクルの処理と同じdone・continueの型である', () => {
    expectTypeOf<
      ReturnType<ProductLifecycleAsyncHandler['handle']>
    >().toEqualTypeOf<Promise<LifecycleHandlerOutcome>>();
    expectTypeOf<
      Parameters<ProductLifecycleAsyncHandler['handle']>[0]
    >().toEqualTypeOf<ProductLifecycleEvent>();
  });
});

describe('createProductLifecycleRegistry', () => {
  test('同じ種類の処理を登録の順ではなくorderの昇順で返す', () => {
    const images = registration(
      'product-launch.product-image-erasure',
      ['purge_due'],
      1000,
    );
    const matches = registration(
      'match-engine.match-record-detach',
      ['purge_due'],
      1100,
    );
    const votes = registration('voting.vote-purge', ['purge_due'], 300);

    const registry = createProductLifecycleRegistry([images, matches, votes]);

    expect(registry.handlersFor('purge_due')).toEqual([votes, images, matches]);
  });

  test('複数の種類に登録した処理を、それぞれの種類の並びに含める', () => {
    const quarantine = registration(
      'product-launch.product-image-quarantine',
      ['hidden', 'unhidden'],
      1000,
    );
    const index = registration(
      'directory-discovery.directory-entry-sync',
      ['deleted', 'hidden', 'unhidden'],
      500,
    );

    const registry = createProductLifecycleRegistry([quarantine, index]);

    expect(registry.handlersFor('deleted')).toEqual([index]);
    expect(registry.handlersFor('hidden')).toEqual([index, quarantine]);
    expect(registry.handlersFor('unhidden')).toEqual([index, quarantine]);
  });

  test('処理の無い種類には空の並びを返す', () => {
    const registry = createProductLifecycleRegistry([
      registration('product-launch.product-image-erasure', ['purge_due'], 1000),
    ]);

    expect(registry.handlersFor('deleted')).toEqual([]);
    expect(createProductLifecycleRegistry([]).handlersFor('purge_due')).toEqual(
      [],
    );
  });

  test('異なる種類の間ではorderが同じでも受け付ける', () => {
    const hidden = registration('voting.vote-hide', ['hidden'], 1000);
    const purge = registration('voting.vote-purge', ['purge_due'], 1000);

    const registry = createProductLifecycleRegistry([hidden, purge]);

    expect(registry.handlersFor('hidden')).toEqual([hidden]);
    expect(registry.handlersFor('purge_due')).toEqual([purge]);
  });

  test('返す並びと集約は凍結されていて実行時に変えられない', () => {
    const registry = createProductLifecycleRegistry([
      registration('product-launch.product-image-erasure', ['purge_due'], 1000),
    ]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.handlersFor('purge_due'))).toBe(true);
    expect(Object.isFrozen(registry.handlersFor('deleted'))).toBe(true);
  });

  test.each([
    ['ドットの無い名前', 'product-launch'],
    ['大文字を含む名前', 'Product-launch.image-erasure'],
    ['アンダースコアを含む名前', 'product_launch.image-erasure'],
    ['名詞句が空の名前', 'product-launch.'],
  ])('名前が<spec名>.<名詞句>の形でない%sの登録を拒否する', (_label, name) => {
    expect(() =>
      createProductLifecycleRegistry([registration(name, ['purge_due'], 1000)]),
    ).toThrow(LifecycleRegistrationError);
  });

  test('名前が重複する登録を、種類が異なっていても拒否する', () => {
    expect(() =>
      createProductLifecycleRegistry([
        registration('voting.vote-purge', ['purge_due'], 300),
        registration('voting.vote-purge', ['deleted'], 400),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'プロダクトライフサイクルの処理の名前が重複しています: "voting.vote-purge"',
      ),
    );
  });

  test('同じ種類でorderが重複する登録を拒否する', () => {
    expect(() =>
      createProductLifecycleRegistry([
        registration(
          'product-launch.product-image-quarantine',
          ['hidden', 'purge_due'],
          1000,
        ),
        registration(
          'product-launch.product-image-erasure',
          ['purge_due'],
          1000,
        ),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        '種類"purge_due"のプロダクトライフサイクルの処理"product-launch.product-image-quarantine"と"product-launch.product-image-erasure"のorderが重複しています: 1000',
      ),
    );
  });

  test('1つの登録の中で同じ種類を重ねて挙げた登録を拒否する', () => {
    expect(() =>
      createProductLifecycleRegistry([
        registration('voting.vote-hide', ['hidden', 'hidden'], 300),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'プロダクトライフサイクルの処理"voting.vote-hide"が種類"hidden"を重ねて挙げています',
      ),
    );
  });

  test.each([
    ['小数', 1000.5],
    ['非数', Number.NaN],
    ['無限大', Number.POSITIVE_INFINITY],
  ])('orderが%sの登録を拒否する', (_label, order) => {
    expect(() =>
      createProductLifecycleRegistry([
        registration(
          'product-launch.product-image-erasure',
          ['purge_due'],
          order,
        ),
      ]),
    ).toThrow(LifecycleRegistrationError);
  });

  test('名前の形式とorderの違反の文言は、ユーザーライフサイクルの波及処理と区別できるプロダクトライフサイクルの処理の呼び名を使う', () => {
    expect(PRODUCT_LIFECYCLE_HANDLER_LABEL).toBe(
      'プロダクトライフサイクルの処理',
    );
    expect(() =>
      createProductLifecycleRegistry([
        registration('product_launch.image-erasure', ['purge_due'], 1000),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'プロダクトライフサイクルの処理の名前は<spec名>.<名詞句>の形で指定してください: "product_launch.image-erasure"',
      ),
    );
    expect(() =>
      createProductLifecycleRegistry([
        registration(
          'product-launch.product-image-erasure',
          ['purge_due'],
          1.5,
        ),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'プロダクトライフサイクルの処理"product-launch.product-image-erasure"のorderは整数で指定してください: 1.5',
      ),
    );
  });
});

describe('PRODUCT_LIFECYCLE_RETRY_POLICY', () => {
  test('5回目の試行で打ち切り、300秒から倍にして3600秒で止める', () => {
    expect(PRODUCT_LIFECYCLE_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 300,
      maxDelaySeconds: 3600,
    });
    expect(Object.isFrozen(PRODUCT_LIFECYCLE_RETRY_POLICY)).toBe(true);
  });

  test('Queueの再配信の回数に収まり、300・600・1200・2400秒の再試行の後にデッドレターになる', () => {
    expect(() => {
      assertRetryPolicy(PRODUCT_LIFECYCLE_RETRY_POLICY);
    }).not.toThrow();
    expect(
      [1, 2, 3, 4, 5].map((attempts) =>
        decideOnFailure(PRODUCT_LIFECYCLE_RETRY_POLICY, attempts),
      ),
    ).toEqual([
      { kind: 'retry', delaySeconds: 300 },
      { kind: 'retry', delaySeconds: 600 },
      { kind: 'retry', delaySeconds: 1200 },
      { kind: 'retry', delaySeconds: 2400 },
      { kind: 'dead-letter' },
    ]);
  });
});
