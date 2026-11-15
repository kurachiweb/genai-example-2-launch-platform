import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  type StoredLifecycleEvent,
  USER_LIFECYCLE_EVENT_STATUSES,
  type UserLifecycleEventStatus,
  type UserLifecycleStore,
} from './ports.ts';
import type { UserLifecycleEvent } from './user-lifecycle.ts';

describe('USER_LIFECYCLE_EVENT_STATUSES', () => {
  test('イベントの状態は未完了と完了の2つで、変更できない', () => {
    expect(USER_LIFECYCLE_EVENT_STATUSES).toEqual(['pending', 'completed']);
    expect(Object.isFrozen(USER_LIFECYCLE_EVENT_STATUSES)).toBe(true);
    expectTypeOf<UserLifecycleEventStatus>().toEqualTypeOf<
      'pending' | 'completed'
    >();
  });
});

describe('StoredLifecycleEvent', () => {
  test('イベントに状態と送信の回数と最後の送信日時を加えた形で、イベントとして渡せる', () => {
    const stored: StoredLifecycleEvent = {
      id: '01JC0EVT000000000000000001',
      userId: '01JC0USER00000000000000001',
      type: 'withdrawn',
      occurredAt: new Date('2026-11-01T00:00:00.000Z'),
      status: 'pending',
      dispatchCount: 1,
      lastDispatchedAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    const event: UserLifecycleEvent = stored;

    expect(event.type).toBe('withdrawn');
    expectTypeOf<StoredLifecycleEvent>().toExtend<UserLifecycleEvent>();
  });
});

describe('UserLifecycleStore', () => {
  test('物理削除の開始のイベントの作成は作ったイベントだけを返す', () => {
    expectTypeOf<
      ReturnType<UserLifecycleStore['createPurgeDueEvents']>
    >().toEqualTypeOf<Promise<readonly UserLifecycleEvent[]>>();
    expectTypeOf<
      ReturnType<UserLifecycleStore['completedHandlers']>
    >().toEqualTypeOf<Promise<ReadonlySet<string>>>();
  });
});
