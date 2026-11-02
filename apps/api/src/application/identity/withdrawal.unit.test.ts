import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/identity.ts';
import {
  currentOf,
  META,
  NOW,
  RE_AUTHENTICATION,
  REAUTHENTICATION_FAILED,
  rejectionOf,
  USER_ID,
  userOf,
} from './testing/credential-change-fakes.ts';
import {
  createUserLifecycleFakes,
  EVENT_ID,
  type UserLifecycleFakeOptions,
} from './testing/user-lifecycle-fakes.ts';
import {
  commitWithdrawal,
  StoreWithdrawal,
  type Withdrawal,
} from './withdrawal.ts';

function setup(options: UserLifecycleFakeOptions = {}) {
  const fakes = createUserLifecycleFakes(options);
  const withdrawal: Withdrawal = new StoreWithdrawal(
    fakes.reAuthenticator,
    fakes.committer,
    fakes.publisher,
    fakes.reporter,
  );
  return { withdrawal, fakes, recorded: fakes.recorded };
}

const STATE_CONFLICT = new AppError({
  kind: 'conflict',
  code: 'account_state_conflict',
  message: '処理が重なりました。時間をおいて再度お試しください。',
});

const PUBLISH_FAILURE = new Error('Queueへの送信に失敗した');

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    sinks: { memory: (record) => records.push(record) },
    loggers: [
      { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: [] },
      { category: ['api'], lowestLevel: 'debug', sinks: ['memory'] },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('commitWithdrawal', () => {
  test('読み取った版で退会の遷移を確定し、確定したイベントのIDで非同期の波及処理の実行を送る', async () => {
    const { fakes, recorded } = setup();
    const user = userOf({ lifecycleVersion: 7 });

    await commitWithdrawal(fakes, user, NOW);

    expect(recorded.calls).toEqual(['committer.commit', 'publisher.publish']);
    expect(recorded.transitions).toEqual([
      { kind: 'withdraw', userId: USER_ID, expectedVersion: 7, at: NOW },
    ]);
    expect(recorded.published).toEqual([
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: EVENT_ID },
        options: undefined,
      },
    ]);
    expect(recorded.incidents).toEqual([]);
  });

  test('送信に失敗しても成功として返し、イベントのIDを添えて運用者へ通知する', async () => {
    const { fakes, recorded } = setup({ publishError: PUBLISH_FAILURE });

    await commitWithdrawal(fakes, userOf(), NOW);

    expect(recorded.incidents).toEqual([
      { kind: 'lifecycle-publish-failed', eventId: EVENT_ID },
    ]);
    expect(recorded.calls).toEqual([
      'committer.commit',
      'publisher.publish',
      'reporter.report',
    ]);
    const logged = records.find(
      (record) => record.category.join('.') === 'api.identity.user-lifecycle',
    );
    expect(logged?.level).toBe('error');
    expect(logged?.properties).toEqual({
      error: PUBLISH_FAILURE,
      eventId: EVENT_ID,
      userId: USER_ID,
    });
  });

  test('版の競合は例外をそのまま投げ、送信も通知もしない', async () => {
    const { fakes, recorded } = setup({ commitError: STATE_CONFLICT });

    const rejection = await rejectionOf(commitWithdrawal(fakes, userOf(), NOW));

    expect(rejection).toBe(STATE_CONFLICT);
    expect(recorded.calls).toEqual(['committer.commit']);
  });
});

describe('StoreWithdrawal.withdraw', () => {
  test('本人確認の後に、現在の利用者の版で退会を確定して非同期の波及処理の実行を送る', async () => {
    const { withdrawal, recorded } = setup();
    const user = userOf({ lifecycleVersion: 3 });

    await withdrawal.withdraw(currentOf(user), RE_AUTHENTICATION, META);

    expect(recorded.calls).toEqual([
      'reAuthenticator.verify',
      'committer.commit',
      'publisher.publish',
    ]);
    expect(recorded.reAuthentications).toEqual([
      { user, input: RE_AUTHENTICATION, meta: META },
    ]);
    expect(recorded.transitions).toEqual([
      { kind: 'withdraw', userId: USER_ID, expectedVersion: 3, at: NOW },
    ]);
    expect(recorded.published).toEqual([
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: EVENT_ID },
        options: undefined,
      },
    ]);
  });

  test('停止中の利用者でも、ログイン中であれば退会を受け付ける', async () => {
    const { withdrawal, recorded } = setup();
    const suspended = userOf({
      status: 'suspended',
      lifecycleVersion: 2,
    });

    await withdrawal.withdraw(currentOf(suspended), RE_AUTHENTICATION, META);

    expect(recorded.transitions).toEqual([
      { kind: 'withdraw', userId: USER_ID, expectedVersion: 2, at: NOW },
    ]);
  });

  test('メールアドレスが確認済みでない利用者も退会できる', async () => {
    const { withdrawal, recorded } = setup();

    await withdrawal.withdraw(
      currentOf(userOf({ emailVerifiedAt: null })),
      RE_AUTHENTICATION,
      META,
    );

    expect(recorded.transitions).toHaveLength(1);
  });

  test('本人確認に失敗したら例外をそのまま投げ、状態を変えない', async () => {
    const { withdrawal, recorded } = setup({
      reAuthError: REAUTHENTICATION_FAILED,
    });

    const rejection = await rejectionOf(
      withdrawal.withdraw(currentOf(), RE_AUTHENTICATION, META),
    );

    expect(rejection).toBe(REAUTHENTICATION_FAILED);
    expect(recorded.calls).toEqual(['reAuthenticator.verify']);
  });

  test('送信に失敗しても退会は成功として返し、運用者へ通知する', async () => {
    const { withdrawal, recorded } = setup({ publishError: PUBLISH_FAILURE });

    await withdrawal.withdraw(currentOf(), RE_AUTHENTICATION, META);

    expect(recorded.incidents).toEqual([
      { kind: 'lifecycle-publish-failed', eventId: EVENT_ID },
    ]);
  });

  test('版の競合はaccount_state_conflictのまま投げる', async () => {
    const { withdrawal, recorded } = setup({ commitError: STATE_CONFLICT });

    const rejection = await rejectionOf(
      withdrawal.withdraw(currentOf(), RE_AUTHENTICATION, META),
    );

    expect(rejection).toBe(STATE_CONFLICT);
    expect(recorded.published).toEqual([]);
  });
});
