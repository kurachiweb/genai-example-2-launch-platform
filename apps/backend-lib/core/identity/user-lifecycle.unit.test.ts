import { describe, expect, expectTypeOf, test } from 'bun:test';

import type { ServiceIdentifier } from 'inversify';

import {
  assertRetryPolicy,
  decideOnFailure,
} from '../messaging/retry-policy.ts';
import {
  assertLifecycleHandlerName,
  createAsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  LifecycleRegistrationError,
  type SyncLifecycleEventType,
  USER_LIFECYCLE_EVENT_TYPES,
  USER_LIFECYCLE_RETRY_POLICY,
  type UserLifecycleAsyncHandler,
  type UserLifecycleAsyncRegistration,
  type UserLifecycleEventType,
} from './user-lifecycle.ts';

function handlerId(name: string): ServiceIdentifier<UserLifecycleAsyncHandler> {
  return Symbol.for(`test.${name}`);
}

function registration(
  name: string,
  events: readonly UserLifecycleEventType[],
  order: number,
): UserLifecycleAsyncRegistration {
  return { name, events, order, handler: handlerId(name) };
}

describe('USER_LIFECYCLE_EVENT_TYPES', () => {
  test('退会・停止・停止解除・物理削除の開始の4種類をこの順で持つ', () => {
    expect([...USER_LIFECYCLE_EVENT_TYPES]).toEqual([
      'withdrawn',
      'suspended',
      'unsuspended',
      'purge_due',
    ]);
    expect(Object.isFrozen(USER_LIFECYCLE_EVENT_TYPES)).toBe(true);
  });

  test('同期の波及処理の種類は物理削除の開始を除いた3種類である', () => {
    expectTypeOf<SyncLifecycleEventType>().toEqualTypeOf<
      'withdrawn' | 'suspended' | 'unsuspended'
    >();
  });
});

describe('assertLifecycleHandlerName', () => {
  test.each([
    'identity-auth.email-suppression-cleanup',
    'user-profile-social.owned-files-purge',
    'payments.refund-sweep',
    'media-pipeline2.cleanup',
  ])('%sを受け付ける', (name) => {
    expect(() => {
      assertLifecycleHandlerName(name);
    }).not.toThrow();
  });

  test.each([
    ['空の名前', ''],
    ['ドットの無い名前', 'identity-auth'],
    ['ドットが2つの名前', 'identity-auth.email.cleanup'],
    ['spec名が空の名前', '.email-cleanup'],
    ['名詞句が空の名前', 'identity-auth.'],
    ['大文字を含む名前', 'Identity-auth.cleanup'],
    ['アンダースコアを含む名前', 'identity_auth.cleanup'],
    ['ハイフンが連続する名前', 'identity--auth.cleanup'],
    ['ハイフンで終わる部分を持つ名前', 'identity-auth.cleanup-'],
    ['ハイフンで始まる部分を持つ名前', 'identity-auth.-cleanup'],
    ['数字で始まる部分を持つ名前', 'identity-auth.1cleanup'],
    ['空白を含む名前', 'identity-auth.email cleanup'],
  ])('%sを拒否する', (_label, name) => {
    expect(() => {
      assertLifecycleHandlerName(name);
    }).toThrow(LifecycleRegistrationError);
  });
});

describe('createAsyncLifecycleRegistry', () => {
  test('同じ種類の波及処理を登録の順ではなくorderの昇順で返す', () => {
    const files = registration(
      'user-profile-social.owned-files-purge',
      ['purge_due'],
      300,
    );
    const votes = registration('voting.vote-purge', ['purge_due'], 100);
    const payments = registration(
      'payments.customer-purge',
      ['purge_due'],
      200,
    );

    const registry = createAsyncLifecycleRegistry([files, votes, payments]);

    expect(registry.handlersFor('purge_due')).toEqual([votes, payments, files]);
  });

  test('各ドメインの帯の値(9999以下)と本specの値(10000以上)を受け付け、本specの波及処理を同じ種類の各ドメインの波及処理の後に並べる', () => {
    const identity = registration(
      'identity-auth.email-suppression-cleanup',
      ['purge_due'],
      10000,
    );
    const lastDomain = registration(
      'ugc-moderation.report-purge',
      ['purge_due'],
      9999,
    );
    const firstDomain = registration(
      'launch-board.entry-purge',
      ['purge_due'],
      0,
    );

    const registry = createAsyncLifecycleRegistry([
      identity,
      lastDomain,
      firstDomain,
    ]);

    expect(registry.handlersFor('purge_due')).toEqual([
      firstDomain,
      lastDomain,
      identity,
    ]);
  });

  test('複数の種類に登録した波及処理を、それぞれの種類の並びに含める', () => {
    const hide = registration(
      'launch-board.entry-visibility',
      ['withdrawn', 'suspended', 'unsuspended'],
      100,
    );
    const notify = registration(
      'ugc-moderation.suspension-notice',
      ['suspended'],
      50,
    );

    const registry = createAsyncLifecycleRegistry([hide, notify]);

    expect(registry.handlersFor('withdrawn')).toEqual([hide]);
    expect(registry.handlersFor('suspended')).toEqual([notify, hide]);
    expect(registry.handlersFor('unsuspended')).toEqual([hide]);
  });

  test('波及処理の無い種類には空の並びを返す', () => {
    const registry = createAsyncLifecycleRegistry([
      registration('voting.vote-purge', ['purge_due'], 100),
    ]);

    expect(registry.handlersFor('withdrawn')).toEqual([]);
    expect(createAsyncLifecycleRegistry([]).handlersFor('purge_due')).toEqual(
      [],
    );
  });

  test('異なる種類の間ではorderが同じでも受け付ける', () => {
    const withdrawn = registration('voting.vote-hide', ['withdrawn'], 100);
    const purge = registration('voting.vote-purge', ['purge_due'], 100);

    const registry = createAsyncLifecycleRegistry([withdrawn, purge]);

    expect(registry.handlersFor('withdrawn')).toEqual([withdrawn]);
    expect(registry.handlersFor('purge_due')).toEqual([purge]);
  });

  test('返す並びと集約は凍結されていて実行時に変えられない', () => {
    const registry = createAsyncLifecycleRegistry([
      registration('voting.vote-purge', ['purge_due'], 100),
    ]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.handlersFor('purge_due'))).toBe(true);
    expect(Object.isFrozen(registry.handlersFor('withdrawn'))).toBe(true);
  });

  test('名前が<spec名>.<名詞句>の形でない登録を拒否する', () => {
    expect(() =>
      createAsyncLifecycleRegistry([
        registration('vote_purge', ['purge_due'], 100),
      ]),
    ).toThrow(LifecycleRegistrationError);
  });

  test('名前が重複する登録を、種類が異なっていても拒否する', () => {
    expect(() =>
      createAsyncLifecycleRegistry([
        registration('voting.vote-purge', ['purge_due'], 100),
        registration('voting.vote-purge', ['withdrawn'], 200),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        '波及処理の名前が重複しています: "voting.vote-purge"',
      ),
    );
  });

  test('同じ種類でorderが重複する登録を拒否する', () => {
    expect(() =>
      createAsyncLifecycleRegistry([
        registration('voting.vote-purge', ['withdrawn', 'purge_due'], 100),
        registration('payments.customer-purge', ['purge_due'], 100),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        '種類"purge_due"の波及処理"voting.vote-purge"と"payments.customer-purge"のorderが重複しています: 100',
      ),
    );
  });

  test('1つの登録の中で同じ種類を重ねて挙げた登録を拒否する', () => {
    expect(() =>
      createAsyncLifecycleRegistry([
        registration('voting.vote-purge', ['purge_due', 'purge_due'], 100),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        '波及処理"voting.vote-purge"が種類"purge_due"を重ねて挙げています',
      ),
    );
  });

  test.each([
    ['小数', 1.5],
    ['非数', Number.NaN],
    ['無限大', Number.POSITIVE_INFINITY],
  ])('orderが%sの登録を拒否する', (_label, order) => {
    expect(() =>
      createAsyncLifecycleRegistry([
        registration('voting.vote-purge', ['purge_due'], order),
      ]),
    ).toThrow(LifecycleRegistrationError);
  });

  test('エラーの名前はLifecycleRegistrationErrorである', () => {
    expect(new LifecycleRegistrationError('x').name).toBe(
      'LifecycleRegistrationError',
    );
  });
});

describe('USER_LIFECYCLE_RETRY_POLICY', () => {
  test('5回目の試行で打ち切り、300秒から倍にして3600秒で止める', () => {
    expect(USER_LIFECYCLE_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 300,
      maxDelaySeconds: 3600,
    });
    expect(Object.isFrozen(USER_LIFECYCLE_RETRY_POLICY)).toBe(true);
  });

  test('Queueの再配信の回数に収まり、300・600・1200・2400秒の再試行の後にデッドレターになる', () => {
    expect(() => {
      assertRetryPolicy(USER_LIFECYCLE_RETRY_POLICY);
    }).not.toThrow();
    expect(
      [1, 2, 3, 4, 5].map((attempts) =>
        decideOnFailure(USER_LIFECYCLE_RETRY_POLICY, attempts),
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

describe('LIFECYCLE_CONTINUE_DELAY_SECONDS', () => {
  test('続きがある波及処理の遅延の再送の間隔は5秒である', () => {
    expect(LIFECYCLE_CONTINUE_DELAY_SECONDS).toBe(5);
  });
});
