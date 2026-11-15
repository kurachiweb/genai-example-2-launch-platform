import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  DisposableEmailChecker,
  DisposableEmailStatus,
} from '../../../lib/core/identity/disposable-email.ts';
import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { AuthIncident, AuthIncidentReporter } from '../auth/ports.ts';
import {
  type DisposableEmailCheck,
  DISPOSABLE_RECHECK_DELAY_SECONDS,
  SavingDisposableEmailCheck,
} from './disposable-email-check.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  IdentityMessagePublisher,
  IdentityPublishOptions,
  UserAccountStore,
  UserRecord,
} from './ports.ts';

const USER_ID = '01JDISPOSABLE0000000000001';

const REGISTERED_AT = new Date('2026-10-01T00:00:00.000Z');

const CHECKED_AT = new Date('2026-11-02T03:04:05.678Z');

const USER: UserRecord = Object.freeze({
  id: USER_ID,
  status: 'active',
  emailVerifiedAt: CHECKED_AT,
  deletedAt: null,
  pseudonymousId: '0b9c6f0e-6a55-4a1f-9d4e-2f3c5b7a8d91',
  email: 'Taro.Yamada@mail.example',
  passwordHash: 'pbkdf2-sha512$100000$salt$derived',
  nickname: 'やまだ たろう',
  handle: 'handle000001',
  disposableEmailStatus: null,
  termsAgreedAt: REGISTERED_AT,
  lifecycleVersion: 0,
});

interface SavedStatus {
  readonly userId: string;
  readonly status: DisposableEmailStatus;
  readonly at: Date;
}

interface PublishedMessage {
  readonly type: string;
  readonly body: unknown;
  readonly options: IdentityPublishOptions | undefined;
}

interface FakeOptions {
  readonly status?: DisposableEmailStatus;
  readonly publishError?: Error;
  readonly saveError?: Error;
  readonly reportError?: Error;
}

const notUsed = (): never => {
  throw new Error('使い捨て判定では使わない');
};

function createFakes(options: FakeOptions = {}) {
  const calls: string[] = [];
  const checkedEmails: string[] = [];
  const saved: SavedStatus[] = [];
  const published: PublishedMessage[] = [];

  const checker: DisposableEmailChecker = {
    check(email) {
      calls.push('checker.check');
      checkedEmails.push(email);
      return Promise.resolve(options.status ?? 'regular');
    },
  };

  const users: UserAccountStore = {
    findById: notUsed,
    findNotWithdrawnByEmail: notUsed,
    isEmailInUse: notUsed,
    createWithVerification: notUsed,
    markEmailVerified: notUsed,
    saveDisposableStatus(userId, status, at) {
      calls.push('users.saveDisposableStatus');
      saved.push({ userId, status, at });
      return options.saveError === undefined
        ? Promise.resolve()
        : Promise.reject(options.saveError);
    },
    applyPasswordReset: notUsed,
    applyEmailChange: notUsed,
    applyPasswordChange: notUsed,
    listUndetermined: notUsed,
  };

  const publisher: IdentityMessagePublisher = {
    publish<TType extends string, TBody>(
      contract: MessageContract<TType, TBody>,
      body: TBody,
      publishOptions?: IdentityPublishOptions,
    ): Promise<string> {
      calls.push('publisher.publish');
      published.push({ type: contract.type, body, options: publishOptions });
      return options.publishError === undefined
        ? Promise.resolve(`message-${String(published.length)}`)
        : Promise.reject(options.publishError);
    },
  };

  const incidents: AuthIncident[] = [];
  const reporter: AuthIncidentReporter = {
    report(incident) {
      calls.push('reporter.report');
      incidents.push(incident);
      if (options.reportError !== undefined) {
        throw options.reportError;
      }
    },
  };

  return {
    calls,
    checkedEmails,
    saved,
    published,
    incidents,
    checker,
    users,
    publisher,
    reporter,
  };
}

type Fakes = ReturnType<typeof createFakes>;

function createCheck(fakes: Fakes): DisposableEmailCheck {
  return new SavingDisposableEmailCheck(
    fakes.checker,
    fakes.users,
    fakes.publisher,
    fakes.reporter,
  );
}

function setup(options: FakeOptions = {}) {
  const fakes = createFakes(options);
  return { fakes, check: createCheck(fakes) };
}

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

describe('SavingDisposableEmailCheck.checkAndSave', () => {
  test.each<DisposableEmailStatus>(['disposable', 'regular'])(
    '利用者のメールアドレスで判定し、判定できた結果(%s)を判定の日時とともに保存して返し、判定し直しの依頼と運用者への通知をしない',
    async (status) => {
      const { fakes, check } = setup({ status });

      const result = await check.checkAndSave(USER, CHECKED_AT);

      expect(result).toBe(status);
      expect(fakes.checkedEmails).toEqual([USER.email]);
      expect(fakes.saved).toEqual([
        { userId: USER_ID, status, at: CHECKED_AT },
      ]);
      expect(fakes.published).toEqual([]);
      expect(fakes.incidents).toEqual([]);
      expect(fakes.calls).toEqual([
        'checker.check',
        'users.saveDisposableStatus',
      ]);
    },
  );

  test('未判定なら「未判定」として保存し、保存の後に15分後の判定し直しを利用者の識別子だけで依頼する', async () => {
    const { fakes, check } = setup({ status: 'undetermined' });

    const result = await check.checkAndSave(USER, CHECKED_AT);

    expect(result).toBe('undetermined');
    expect(fakes.saved).toEqual([
      { userId: USER_ID, status: 'undetermined', at: CHECKED_AT },
    ]);
    expect(DISPOSABLE_RECHECK_DELAY_SECONDS).toBe(15 * 60);
    expect(fakes.published).toEqual([
      {
        type: 'identity.recheck-disposable-email',
        body: { userId: USER_ID },
        options: { delaySeconds: DISPOSABLE_RECHECK_DELAY_SECONDS },
      },
    ]);
    expect(fakes.calls).toEqual([
      'checker.check',
      'users.saveDisposableStatus',
      'publisher.publish',
      'reporter.report',
    ]);
  });

  test('未判定なら、判定サービスを使えなかったことをメールアドレスを含めずに運用者へ1回だけ通知する', async () => {
    const { fakes, check } = setup({ status: 'undetermined' });

    await check.checkAndSave(USER, CHECKED_AT);

    expect(fakes.incidents).toEqual([
      { kind: 'disposable-email-check-unavailable' },
    ]);
    const serialized = JSON.stringify(fakes.incidents);
    expect(serialized).not.toContain(USER.email);
    expect(serialized).not.toContain('mail.example');
  });

  test('判定し直しの依頼の送信に失敗しても、運用者への通知は行う', async () => {
    const { fakes, check } = setup({
      status: 'undetermined',
      publishError: new Error('キューへの送信に失敗しました'),
    });

    await check.checkAndSave(USER, CHECKED_AT);

    expect(fakes.incidents).toEqual([
      { kind: 'disposable-email-check-unavailable' },
    ]);
  });

  test('通知が例外を投げたら握りつぶさずに投げ、それより前に判定の保存と判定し直しの依頼を済ませている', async () => {
    const reportError = new Error('通知に失敗しました');
    const { fakes, check } = setup({ status: 'undetermined', reportError });

    const rejection: unknown = await check.checkAndSave(USER, CHECKED_AT).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBe(reportError);
    expect(fakes.saved).toEqual([
      { userId: USER_ID, status: 'undetermined', at: CHECKED_AT },
    ]);
    expect(fakes.published).toHaveLength(1);
  });

  test('判定し直しの依頼の送信に失敗しても、日次のジョブが拾うためerrorのログに留めて「未判定」を返す', async () => {
    const { check } = setup({
      status: 'undetermined',
      publishError: new Error('キューへの送信に失敗しました'),
    });

    const result = await check.checkAndSave(USER, CHECKED_AT);

    expect(result).toBe('undetermined');
    const errors = records.filter(
      (record) =>
        record.category.join('.') === 'api.identity.disposable-email-check' &&
        record.level === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.properties).toMatchObject({ userId: USER_ID });
    expect(errors[0]?.properties['error']).toBeInstanceOf(Error);
    expect(JSON.stringify(errors[0]?.properties)).not.toContain(USER.email);
  });

  test('判定の結果を保存できなければ、その例外をそのまま投げて判定し直しを依頼しない', async () => {
    const saveError = new Error('データベースの障害');
    const { fakes, check } = setup({ status: 'undetermined', saveError });

    const rejection: unknown = await check.checkAndSave(USER, CHECKED_AT).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBe(saveError);
    expect(fakes.published).toEqual([]);
    expect(fakes.incidents).toEqual([]);
  });

  test('コンテナで依存を注入して解決できる', async () => {
    const fakes = createFakes({ status: 'undetermined' });
    const container = new Container();
    container
      .bind<DisposableEmailChecker>(IDENTITY_TYPES.DisposableEmailChecker)
      .toConstantValue(fakes.checker);
    container
      .bind<UserAccountStore>(IDENTITY_TYPES.UserAccountStore)
      .toConstantValue(fakes.users);
    container
      .bind<IdentityMessagePublisher>(PLATFORM_TYPES.MessagePublisher)
      .toConstantValue(fakes.publisher);
    container
      .bind<AuthIncidentReporter>(AUTH_TYPES.AuthIncidentReporter)
      .toConstantValue(fakes.reporter);
    container
      .bind<DisposableEmailCheck>(IDENTITY_TYPES.DisposableEmailCheck)
      .to(SavingDisposableEmailCheck);

    const check = container.get<DisposableEmailCheck>(
      IDENTITY_TYPES.DisposableEmailCheck,
    );
    await check.checkAndSave(USER, CHECKED_AT);

    expect(fakes.saved).toHaveLength(1);
    expect(fakes.published).toHaveLength(1);
    expect(fakes.incidents).toHaveLength(1);
  });
});
