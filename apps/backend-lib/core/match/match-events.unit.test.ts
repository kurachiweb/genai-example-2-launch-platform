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
  createMatchEventRegistry,
  MATCH_EVENT_HANDLER_LABEL,
  MATCH_EVENT_RETRY_POLICY,
  MATCH_EVENT_STATUSES,
  MATCH_EVENT_TYPES,
  type MatchEvent,
  type MatchEventHandler,
  type MatchEventRegistration,
  type MatchEventType,
} from './match-events.ts';
import type { MatchKind } from './match-model.ts';

function handlerId(name: string): ServiceIdentifier<MatchEventHandler> {
  return Symbol.for(`test.${name}`);
}

function registration(
  name: string,
  events: readonly MatchEventType[],
  order: number,
  kinds?: readonly MatchKind[],
): MatchEventRegistration {
  return {
    name,
    events,
    order,
    handler: handlerId(name),
    ...(kinds === undefined ? {} : { kinds }),
  };
}

describe('マッチイベントの値の一覧', () => {
  test('種類は予定・開始・確定の3つで、変更できない', () => {
    expect([...MATCH_EVENT_TYPES]).toEqual(['scheduled', 'started', 'decided']);
    expect(Object.isFrozen(MATCH_EVENT_TYPES)).toBe(true);
  });

  test('状態は未完了と完了の2つで、変更できない', () => {
    expect([...MATCH_EVENT_STATUSES]).toEqual(['pending', 'completed']);
    expect(Object.isFrozen(MATCH_EVENT_STATUSES)).toBe(true);
  });
});

describe('MatchEventHandler', () => {
  test('処理はマッチイベントを受け取り、ライフサイクルイベントと同じdone・continueの結果を返す', () => {
    expectTypeOf<ReturnType<MatchEventHandler['handle']>>().toEqualTypeOf<
      Promise<LifecycleHandlerOutcome>
    >();
    expectTypeOf<
      Parameters<MatchEventHandler['handle']>[0]
    >().toEqualTypeOf<MatchEvent>();
  });

  test('イベントはマッチの識別だけを持ち、プロダクトや利用者の情報を持たない', () => {
    expectTypeOf<keyof MatchEvent>().toEqualTypeOf<
      'id' | 'matchId' | 'kind' | 'type' | 'occurredAt'
    >();
  });
});

describe('createMatchEventRegistry', () => {
  test('同じ種類の処理を登録の順ではなくorderの昇順で返す', () => {
    const outcome = registration(
      'match-engine.qualifier-outcome',
      ['decided'],
      1100,
    );
    const bracket = registration(
      'tournament-week.bracket-advance',
      ['decided'],
      1500,
    );
    const notice = registration(
      'notifications.match-result-notice',
      ['decided'],
      1300,
    );

    const registry = createMatchEventRegistry([bracket, outcome, notice]);

    expect(registry.handlersFor({ type: 'decided', kind: 'week' })).toEqual([
      outcome,
      notice,
      bracket,
    ]);
  });

  test('種別を指定した処理は、その種別のイベントだけに返し、省いた処理は全種別に返す', () => {
    const outcome = registration(
      'match-engine.qualifier-outcome',
      ['decided'],
      1100,
      ['qualifier'],
    );
    const bracket = registration(
      'tournament-week.bracket-advance',
      ['decided'],
      1500,
      ['week', 'year'],
    );
    const notice = registration(
      'notifications.match-result-notice',
      ['decided'],
      1300,
    );

    const registry = createMatchEventRegistry([outcome, bracket, notice]);

    expect(
      registry.handlersFor({ type: 'decided', kind: 'qualifier' }),
    ).toEqual([outcome, notice]);
    expect(registry.handlersFor({ type: 'decided', kind: 'week' })).toEqual([
      notice,
      bracket,
    ]);
    expect(registry.handlersFor({ type: 'decided', kind: 'year' })).toEqual([
      notice,
      bracket,
    ]);
  });

  test('複数の種類に登録した処理を、それぞれの種類の並びに含め、処理の無い種類には空の並びを返す', () => {
    const board = registration(
      'directory-discovery.match-board-sync',
      ['scheduled', 'started', 'decided'],
      1200,
    );
    const outcome = registration(
      'match-engine.qualifier-outcome',
      ['decided'],
      1100,
      ['qualifier'],
    );

    const registry = createMatchEventRegistry([board, outcome]);

    expect(
      registry.handlersFor({ type: 'scheduled', kind: 'qualifier' }),
    ).toEqual([board]);
    expect(
      registry.handlersFor({ type: 'started', kind: 'qualifier' }),
    ).toEqual([board]);
    expect(
      registry.handlersFor({ type: 'decided', kind: 'qualifier' }),
    ).toEqual([outcome, board]);
    expect(
      createMatchEventRegistry([]).handlersFor({
        type: 'decided',
        kind: 'qualifier',
      }),
    ).toEqual([]);
  });

  test('異なる種類の間ではorderが同じでも受け付ける', () => {
    const scheduled = registration(
      'notifications.match-scheduled-notice',
      ['scheduled'],
      1300,
    );
    const decided = registration(
      'notifications.match-result-notice',
      ['decided'],
      1300,
    );

    const registry = createMatchEventRegistry([scheduled, decided]);

    expect(registry.handlersFor({ type: 'scheduled', kind: 'week' })).toEqual([
      scheduled,
    ]);
    expect(registry.handlersFor({ type: 'decided', kind: 'week' })).toEqual([
      decided,
    ]);
  });

  test('返す並びと集約は凍結されていて実行時に変えられない', () => {
    const registry = createMatchEventRegistry([
      registration('match-engine.qualifier-outcome', ['decided'], 1100, [
        'qualifier',
      ]),
    ]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(
      Object.isFrozen(
        registry.handlersFor({ type: 'decided', kind: 'qualifier' }),
      ),
    ).toBe(true);
    expect(
      Object.isFrozen(registry.handlersFor({ type: 'decided', kind: 'week' })),
    ).toBe(true);
    expect(
      Object.isFrozen(
        registry.handlersFor({ type: 'started', kind: 'qualifier' }),
      ),
    ).toBe(true);
  });

  test.each([
    ['ドットの無い名前', 'match-engine'],
    ['大文字を含む名前', 'Match-engine.qualifier-outcome'],
    ['アンダースコアを含む名前', 'match_engine.qualifier-outcome'],
    ['名詞句が空の名前', 'match-engine.'],
  ])('名前が<spec名>.<名詞句>の形でない%sの登録を拒否する', (_label, name) => {
    expect(() =>
      createMatchEventRegistry([registration(name, ['decided'], 1100)]),
    ).toThrow(LifecycleRegistrationError);
  });

  test('名前の形式の違反の文言は、他のライフサイクルイベントと区別できるマッチイベントの処理の呼び名を使う', () => {
    expect(MATCH_EVENT_HANDLER_LABEL).toBe('マッチイベントの処理');
    expect(() =>
      createMatchEventRegistry([
        registration('match_engine.qualifier-outcome', ['decided'], 1100),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'マッチイベントの処理の名前は<spec名>.<名詞句>の形で指定してください: "match_engine.qualifier-outcome"',
      ),
    );
  });

  test('名前が重複する登録を、種類が異なっていても拒否する', () => {
    expect(() =>
      createMatchEventRegistry([
        registration('notifications.match-notice', ['scheduled'], 1300),
        registration('notifications.match-notice', ['decided'], 1310),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'マッチイベントの処理の名前が重複しています: "notifications.match-notice"',
      ),
    );
  });

  test('同じ種類でorderが重複する登録を、対象の種別が重ならなくても拒否する', () => {
    expect(() =>
      createMatchEventRegistry([
        registration('match-engine.qualifier-outcome', ['decided'], 1100, [
          'qualifier',
        ]),
        registration('match-engine.tournament-outcome', ['decided'], 1100, [
          'week',
        ]),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        '種類"decided"のマッチイベントの処理"match-engine.qualifier-outcome"と"match-engine.tournament-outcome"のorderが重複しています: 1100',
      ),
    );
  });

  test('1つの登録の中で同じ種類を重ねて挙げた登録を拒否する', () => {
    expect(() =>
      createMatchEventRegistry([
        registration(
          'match-engine.qualifier-outcome',
          ['decided', 'decided'],
          1100,
        ),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'マッチイベントの処理"match-engine.qualifier-outcome"が種類"decided"を重ねて挙げています',
      ),
    );
  });

  test.each([
    ['小数', 1100.5],
    ['非数', Number.NaN],
    ['無限大', Number.POSITIVE_INFINITY],
  ])('orderが%sの登録を拒否する', (_label, order) => {
    expect(() =>
      createMatchEventRegistry([
        registration('match-engine.qualifier-outcome', ['decided'], order),
      ]),
    ).toThrow(LifecycleRegistrationError);
  });

  test('1つの登録の中で同じ種別を重ねて挙げた登録を拒否する', () => {
    expect(() =>
      createMatchEventRegistry([
        registration('match-engine.qualifier-outcome', ['decided'], 1100, [
          'qualifier',
          'qualifier',
        ]),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'マッチイベントの処理"match-engine.qualifier-outcome"が種別"qualifier"を重ねて挙げています',
      ),
    );
  });

  test('対象の種別を空で指定した、どのイベントでも動かない登録を拒否する', () => {
    expect(() =>
      createMatchEventRegistry([
        registration('match-engine.qualifier-outcome', ['decided'], 1100, []),
      ]),
    ).toThrow(
      new LifecycleRegistrationError(
        'マッチイベントの処理"match-engine.qualifier-outcome"の対象の種別は省くか1つ以上指定してください',
      ),
    );
  });
});

describe('MATCH_EVENT_RETRY_POLICY', () => {
  test('5回目の試行で打ち切り、300秒から倍にして3600秒で止める', () => {
    expect(MATCH_EVENT_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 300,
      maxDelaySeconds: 3600,
    });
    expect(Object.isFrozen(MATCH_EVENT_RETRY_POLICY)).toBe(true);
  });

  test('Queueの再配信の回数に収まり、300・600・1200・2400秒の再試行の後にデッドレターになる', () => {
    expect(() => {
      assertRetryPolicy(MATCH_EVENT_RETRY_POLICY);
    }).not.toThrow();
    expect(
      [1, 2, 3, 4, 5].map((attempts) =>
        decideOnFailure(MATCH_EVENT_RETRY_POLICY, attempts),
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
