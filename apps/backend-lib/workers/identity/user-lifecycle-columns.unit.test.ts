import { describe, expect, expectTypeOf, test } from 'bun:test';

import { userLifecycleEvents } from '../../../db/schema/identity/user-lifecycle-events.ts';
import {
  USER_LIFECYCLE_EVENT_TYPES,
  type UserLifecycleEventType,
} from '../../core/identity/user-lifecycle.ts';

// coreはDBディレクトリを読み込めないため、テーブル定義に直書きした値の一覧とcoreの型の一致をここで確かめる
describe('ライフサイクルイベントのテーブル定義の値の一覧', () => {
  test('種類の列の値がcoreのイベントの種類の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof userLifecycleEvents.type.enumValues)[number]
    >().toEqualTypeOf<UserLifecycleEventType>();
    expect([...userLifecycleEvents.type.enumValues]).toEqual([
      ...USER_LIFECYCLE_EVENT_TYPES,
    ]);
  });
});
