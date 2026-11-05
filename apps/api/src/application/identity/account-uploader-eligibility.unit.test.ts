import { describe, expect, test } from 'bun:test';

import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import {
  defineUploadPurpose,
  type UploadPurpose,
} from '../../../lib/core/media/upload-purpose.ts';
import type {
  AuthenticatedPrincipal,
  SessionView,
} from '../../../lib/core/session/session-view.ts';
import type {
  UploaderEligibility,
  UploaderEligibilityDecision,
} from '../media/uploader-eligibility.ts';
import { AccountUploaderEligibility } from './account-uploader-eligibility.ts';
import type { UserRecord } from './ports.ts';

const USER_ID = '01JUSER0000000000000000000';
const REGISTERED_AT = new Date('2026-10-01T00:00:00.000Z');

const USER_PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: '01JSESSION0000000000000000',
});

const SESSION: SessionView = Object.freeze({
  principal: () => Promise.resolve(USER_PRINCIPAL),
});

const PRODUCT_IMAGE = defineUploadPurpose({
  name: 'product-image',
  storage: 'images',
  uploaderKinds: ['user'],
  allowedTypes: ['image/png'],
  maxBytes: 1024,
});

const PURPOSES = [
  PRODUCT_IMAGE,
  defineUploadPurpose({
    name: 'inquiry-attachment',
    storage: 'files',
    uploaderKinds: ['user'],
    allowedTypes: ['application/pdf'],
    maxBytes: 1024,
  }),
];

const ALLOWED: UploaderEligibilityDecision = { allowed: true };

const ACCOUNT_UNAVAILABLE: UploaderEligibilityDecision = {
  allowed: false,
  code: 'account_unavailable',
};

function userOf(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: USER_ID,
    status: 'active',
    emailVerifiedAt: REGISTERED_AT,
    deletedAt: null,
    pseudonymousId: '01JPSEUDONYM00000000000000',
    email: 'user@mail.example',
    passwordHash: 'hashed',
    nickname: '利用者',
    handle: 'user_1',
    disposableEmailStatus: 'regular',
    termsAgreedAt: REGISTERED_AT,
    lifecycleVersion: 0,
    ...overrides,
  };
}

function createGuard(read: () => Promise<CurrentUser | undefined>): {
  readonly guard: AccountGuard;
  readonly sessions: SessionView[];
} {
  const sessions: SessionView[] = [];
  const unused = (): never => {
    throw new Error('判定では使わない');
  };
  return {
    sessions,
    guard: {
      currentUser(session) {
        sessions.push(session);
        return read();
      },
      requireUser: unused,
      requireWritableUser: unused,
      requireVerifiedUser: unused,
    },
  };
}

function setup(user: UserRecord | undefined) {
  const { guard, sessions } = createGuard(() =>
    Promise.resolve(
      user === undefined ? undefined : { principal: USER_PRINCIPAL, user },
    ),
  );
  const eligibility: UploaderEligibility = new AccountUploaderEligibility(
    guard,
  );
  return { eligibility, sessions };
}

function checkWith(
  eligibility: UploaderEligibility,
  purpose: UploadPurpose = PRODUCT_IMAGE,
): Promise<UploaderEligibilityDecision> {
  return eligibility.check({
    session: SESSION,
    principal: USER_PRINCIPAL,
    purpose,
  });
}

describe('AccountUploaderEligibility', () => {
  test.each([
    ['停止中の利用者', userOf({ status: 'suspended' })],
    ['退会済みの利用者', userOf({ deletedAt: REGISTERED_AT })],
    [
      'メールアドレスが未確認で停止中の利用者',
      userOf({ status: 'suspended', emailVerifiedAt: null }),
    ],
    ['読めない利用者', undefined],
  ] as const)(
    '%sは利用できないアカウントとして拒否する',
    async (_label, user) => {
      const { eligibility } = setup(user);

      expect(await checkWith(eligibility)).toEqual(ACCOUNT_UNAVAILABLE);
    },
  );

  test.each([
    ['メールアドレスが確認済みの利用者', userOf()],
    ['メールアドレスが未確認の利用者', userOf({ emailVerifiedAt: null })],
  ] as const)('%sは許可する', async (_label, user) => {
    const { eligibility } = setup(user);

    expect(await checkWith(eligibility)).toEqual(ALLOWED);
  });

  test.each(PURPOSES)(
    '用途($name)によらず、未確認の利用者を確認が必要という理由では拒否しない',
    async (purpose) => {
      const { eligibility } = setup(userOf({ emailVerifiedAt: null }));

      const decision = await checkWith(eligibility, purpose);

      expect(decision).toEqual(ALLOWED);
      expect(decision).not.toHaveProperty('code', 'email_not_verified');
    },
  );

  test('同じ要求のセッションで機能制限の判定から利用者を読む', async () => {
    const { eligibility, sessions } = setup(userOf());

    await checkWith(eligibility);

    expect(sessions).toEqual([SESSION]);
  });

  test('利用者の読み取りの失敗は、判定を返さずにそのまま投げる', async () => {
    const failure = new Error('D1の読み取りに失敗しました');
    const { guard } = createGuard(() => Promise.reject(failure));

    const thrown = await checkWith(new AccountUploaderEligibility(guard)).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBe(failure);
  });
});
