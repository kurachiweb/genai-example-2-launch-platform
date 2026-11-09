import { describe, expect, test } from 'bun:test';

import type { LaunchPlanView } from '../../graphql/my-products.ts';
import type { ProductLaunchView } from '../../graphql/product-launch.ts';
import {
  changeLockReasonOf,
  editRefreshBoundariesOf,
} from './product-edit-state.ts';

const LOCK_MESSAGE =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';
const WEEK_LOCK_MESSAGE = 'Weekトーナメントの参加中のため変更できません。';
const UNKNOWN_REASON =
  'ローンチの状態を確認できませんでした。時間をおいて再度お試しください。';

const launchOf = (status: ProductLaunchView['status']): ProductLaunchView => ({
  id: '01JD0LAUNCH000000000000001',
  number: 1,
  launchDate: '2026-11-20',
  kickoffAt: '2026-11-20T08:00:00.000Z',
  status,
  outcome: null,
  summary: { label: 'キックオフ予定', inMatch: false },
});

const planOf = (overrides: Partial<LaunchPlanView>): LaunchPlanView => ({
  mode: 'reschedule',
  currentLaunchDate: '2026-11-20',
  window: null,
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
  ...overrides,
});

describe('editRefreshBoundariesOf', () => {
  test('予定のローンチは、前日の23:45の固定の始まりとキックオフの0:00で取り直す', () => {
    expect(editRefreshBoundariesOf(launchOf('scheduled'))).toEqual([
      '2026-11-20T07:45:00.000Z',
      '2026-11-20T08:00:00.000Z',
    ]);
  });

  test('ペアリング済みのローンチは、キックオフの0:00だけで取り直す', () => {
    expect(editRefreshBoundariesOf(launchOf('paired'))).toEqual([
      '2026-11-20T08:00:00.000Z',
    ]);
  });

  test.each(['in_progress', 'finished', 'canceled'] as const)(
    '%sのローンチとローンチの無いプロダクトは取り直さない',
    (status) => {
      expect(editRefreshBoundariesOf(launchOf(status))).toEqual([]);
      expect(editRefreshBoundariesOf(null)).toEqual([]);
    },
  );
});

describe('changeLockReasonOf', () => {
  test('固定の期間でなく固定の判定もできたなら、理由は無い', () => {
    expect(changeLockReasonOf(planOf({}))).toBeUndefined();
  });

  test('固定の期間は、すべての固定の理由をつなげる', () => {
    expect(
      changeLockReasonOf(
        planOf({
          locked: true,
          locks: [
            { code: 'qualifier_match', message: LOCK_MESSAGE },
            { code: 'tournament-week.match', message: WEEK_LOCK_MESSAGE },
          ],
        }),
      ),
    ).toBe(`${LOCK_MESSAGE}${WEEK_LOCK_MESSAGE}`);
  });

  test('固定の判定に失敗したなら、時間をおいて試す旨を固定の理由の後に加える', () => {
    expect(changeLockReasonOf(planOf({ lockUnknown: true }))).toBe(
      UNKNOWN_REASON,
    );
    expect(
      changeLockReasonOf(
        planOf({
          locked: true,
          locks: [{ code: 'qualifier_match', message: LOCK_MESSAGE }],
          lockUnknown: true,
        }),
      ),
    ).toBe(`${LOCK_MESSAGE}${UNKNOWN_REASON}`);
  });
});
