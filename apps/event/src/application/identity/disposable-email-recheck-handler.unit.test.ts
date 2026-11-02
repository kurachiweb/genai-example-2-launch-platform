import { describe, expect, test } from 'bun:test';

import type {
  DisposableEmailChecker,
  DisposableEmailStatus,
} from '../../../lib/core/identity/disposable-email.ts';
import { DisposableEmailRecheckHandler } from './disposable-email-recheck-handler.ts';
import type {
  DisposableRecheckSubject,
  DisposableStatusStore,
} from './ports.ts';

const NOW = new Date('2026-11-02T07:21:00.000Z');

const USER_ID = '01JC0USER00000000000000001';

const EMAIL = 'someone@mail.example';

interface SavedResult {
  readonly userId: string;
  readonly email: string;
  readonly status: DisposableEmailStatus;
  readonly at: Date;
}

function subjectOf(
  columns: Partial<DisposableRecheckSubject> = {},
): DisposableRecheckSubject {
  return {
    email: EMAIL,
    withdrawn: false,
    emailVerified: true,
    status: 'undetermined',
    ...columns,
  };
}

function createHarness(
  subject: DisposableRecheckSubject | undefined,
  result: DisposableEmailStatus,
) {
  const saved: SavedResult[] = [];
  const checked: string[] = [];
  const store: DisposableStatusStore = {
    findSubject: (userId) =>
      Promise.resolve(userId === USER_ID ? subject : undefined),
    saveRecheckResult: (userId, email, status, at) => {
      saved.push({ userId, email, status, at });
      return Promise.resolve();
    },
  };
  const checker: DisposableEmailChecker = {
    check: (email) => {
      checked.push(email);
      return Promise.resolve(result);
    },
  };
  const handler = new DisposableEmailRecheckHandler(store, checker, {
    now: () => NOW,
  });
  return { handler, saved, checked };
}

describe('DisposableEmailRecheckHandler', () => {
  test.each(['regular', 'disposable'] as const)(
    '未判定の確認済みの利用者を判定し直し、結果(%s)を判定したメールアドレスとともに保存する',
    async (result) => {
      const { handler, saved, checked } = createHarness(subjectOf(), result);

      expect(await handler.handle({ userId: USER_ID })).toEqual({
        kind: 'done',
      });

      expect(checked).toEqual([EMAIL]);
      expect(saved).toEqual([
        { userId: USER_ID, email: EMAIL, status: result, at: NOW },
      ]);
    },
  );

  test('判定が空の確認済みの利用者も判定し直す', async () => {
    const { handler, saved } = createHarness(
      subjectOf({ status: null }),
      'regular',
    );

    await handler.handle({ userId: USER_ID });

    expect(saved).toEqual([
      { userId: USER_ID, email: EMAIL, status: 'regular', at: NOW },
    ]);
  });

  test('判定し直しても未判定なら、例外にせず未判定と判定の日時を保存して完了する', async () => {
    const { handler, saved } = createHarness(subjectOf(), 'undetermined');

    expect(await handler.handle({ userId: USER_ID })).toEqual({
      kind: 'done',
    });

    expect(saved).toEqual([
      { userId: USER_ID, email: EMAIL, status: 'undetermined', at: NOW },
    ]);
  });

  test.each([
    { label: '利用者の行が無い', subject: undefined },
    { label: '退会済み', subject: subjectOf({ withdrawn: true }) },
    { label: '未確認', subject: subjectOf({ emailVerified: false }) },
    {
      label: '使い捨てと判定済み',
      subject: subjectOf({ status: 'disposable' }),
    },
    { label: '通常と判定済み', subject: subjectOf({ status: 'regular' }) },
  ])(
    '$labelなら判定サービスを呼ばず、何も保存せずに完了する',
    async ({ subject }) => {
      const { handler, saved, checked } = createHarness(subject, 'regular');

      expect(await handler.handle({ userId: USER_ID })).toEqual({
        kind: 'done',
      });

      expect(checked).toEqual([]);
      expect(saved).toEqual([]);
    },
  );
});
