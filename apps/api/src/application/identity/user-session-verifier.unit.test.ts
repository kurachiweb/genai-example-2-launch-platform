import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type {
  HashPurpose,
  KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { USER_SESSION_POLICY } from '../../domain/auth/session-policy.ts';
import type { UserAccountSnapshot } from '../../domain/identity/user-account.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import {
  HashingSecretIssuer,
  type SecretIssuer,
} from '../auth/secret-issuer.ts';
import {
  SubjectSessionVerifier,
  type SubjectSessionVerifierPort,
  InvalidSubjectSessionVerifier,
} from '../auth/subject-session-verifier.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type { StoredSession, UserSessionStore } from './ports.ts';
import { UserSessionVerifier } from './user-session-verifier.ts';

const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
const TOKEN_HASH = `hashed(user-session):${TOKEN}`;
const USER_ID = '01JUSER0000000000000000000';
const SESSION_ID = '01JSESSION0000000000000000';
const ISSUED_AT = new Date('2026-10-01T00:00:00.000Z');
const MS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

type FoundSession = StoredSession & { readonly user: UserAccountSnapshot };

interface Recorded {
  readonly lookups: string[];
  readonly touched: { sessionId: string; at: Date }[];
  readonly deleted: { userId: string; sessionId: string }[];
}

function createStore(
  found: FoundSession | undefined,
  recorded: Recorded,
): UserSessionStore {
  const unused = (): never => {
    throw new Error('検証では使わない');
  };
  return {
    insert: unused,
    findByTokenHash(tokenHash) {
      recorded.lookups.push(tokenHash);
      return Promise.resolve(
        tokenHash === found?.tokenHash ? found : undefined,
      );
    },
    touch(sessionId, at) {
      recorded.touched.push({ sessionId, at });
      return Promise.resolve();
    },
    listByUser: unused,
    deleteOne(userId, sessionId) {
      recorded.deleted.push({ userId, sessionId });
      return Promise.resolve(true);
    },
    deleteOthers: unused,
    deleteExpired: unused,
  };
}

const fakeHasher: KeyedHasher = {
  hash: (purpose: HashPurpose, value: string) =>
    Promise.resolve(`hashed(${purpose}):${value}`),
  verify: () => Promise.resolve(false),
};

function createSecretIssuer(): SecretIssuer {
  return new HashingSecretIssuer(
    {
      token: () => {
        throw new Error('検証では発行しない');
      },
      randomString: () => '',
      uuid: () => '',
    },
    fakeHasher,
  );
}

function sessionOf(
  overrides: {
    readonly lastUsedAt?: Date;
    readonly user?: Partial<UserAccountSnapshot>;
  } = {},
): FoundSession {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    tokenHash: TOKEN_HASH,
    userAgent: 'Mozilla/5.0',
    createdAt: ISSUED_AT,
    lastUsedAt: overrides.lastUsedAt ?? ISSUED_AT,
    absoluteExpiresAt: new Date(
      ISSUED_AT.getTime() + USER_SESSION_POLICY.absoluteSeconds * MS_PER_SECOND,
    ),
    user: {
      id: USER_ID,
      status: 'active',
      emailVerifiedAt: ISSUED_AT,
      deletedAt: null,
      ...overrides.user,
    },
  };
}

const after = (base: Date, seconds: number): Date =>
  new Date(base.getTime() + seconds * MS_PER_SECOND);

function setup(found: FoundSession | undefined, now: Date) {
  const recorded: Recorded = { lookups: [], touched: [], deleted: [] };
  const clock: Clock = { now: () => now };
  const verifier = new UserSessionVerifier(
    createSecretIssuer(),
    createStore(found, recorded),
    clock,
  );
  return { verifier, recorded };
}

const expectedPrincipal = {
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: SESSION_ID,
} as const;

describe('UserSessionVerifier の無効', () => {
  test('用途user-sessionのハッシュで探し、無ければ無効にして何も消さない', async () => {
    const { verifier, recorded } = setup(undefined, after(ISSUED_AT, 60));

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.lookups).toEqual([TOKEN_HASH]);
    expect(recorded.deleted).toEqual([]);
    expect(recorded.touched).toEqual([]);
  });

  test('利用者が退会済みならセッションを削除して無効にする', async () => {
    const { verifier, recorded } = setup(
      sessionOf({ user: { deletedAt: after(ISSUED_AT, 30) } }),
      after(ISSUED_AT, 60),
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.deleted).toEqual([
      { userId: USER_ID, sessionId: SESSION_ID },
    ]);
    expect(recorded.touched).toEqual([]);
  });

  test('最後の利用からアイドルの14日ちょうどで期限切れとして削除し、無効にする', async () => {
    const lastUsedAt = after(ISSUED_AT, 10 * SECONDS_PER_DAY);
    const { verifier, recorded } = setup(
      sessionOf({ lastUsedAt }),
      after(lastUsedAt, 14 * SECONDS_PER_DAY),
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.deleted).toEqual([
      { userId: USER_ID, sessionId: SESSION_ID },
    ]);
    expect(recorded.touched).toEqual([]);
  });

  test('発行から絶対の90日ちょうどで、利用が続いていても期限切れとして削除し、無効にする', async () => {
    const now = after(ISSUED_AT, 90 * SECONDS_PER_DAY);
    const { verifier, recorded } = setup(
      sessionOf({ lastUsedAt: after(now, -60) }),
      now,
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.deleted).toEqual([
      { userId: USER_ID, sessionId: SESSION_ID },
    ]);
  });
});

describe('UserSessionVerifier の有効', () => {
  test('最後の更新から15分未満なら更新せず、延長の指示も付けない', async () => {
    const { verifier, recorded } = setup(
      sessionOf(),
      after(ISSUED_AT, 15 * 60 - 1),
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'valid', principal: expectedPrincipal });
    expect(recorded.touched).toEqual([]);
    expect(recorded.deleted).toEqual([]);
  });

  test('最後の更新から15分以上なら最終利用日時を更新し、同じトークンとアイドル期限までの有効期間で延長を指示する', async () => {
    const now = after(ISSUED_AT, 15 * 60);
    const { verifier, recorded } = setup(sessionOf(), now);

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({
      status: 'valid',
      principal: expectedPrincipal,
      renewal: { token: TOKEN, maxAgeSeconds: 14 * SECONDS_PER_DAY },
    });
    expect(recorded.touched).toEqual([{ sessionId: SESSION_ID, at: now }]);
  });

  test('延長の有効期間は絶対期限が先に来るならそこまでに縮める', async () => {
    const now = after(ISSUED_AT, 85 * SECONDS_PER_DAY);
    const { verifier } = setup(
      sessionOf({ lastUsedAt: after(now, -SECONDS_PER_DAY) }),
      now,
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({
      status: 'valid',
      principal: expectedPrincipal,
      renewal: { token: TOKEN, maxAgeSeconds: 5 * SECONDS_PER_DAY },
    });
  });

  test('停止中の利用者のセッションも削除せずに有効のまま返す', async () => {
    const now = after(ISSUED_AT, 60 * 60);
    const { verifier, recorded } = setup(
      sessionOf({ user: { status: 'suspended' } }),
      now,
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({
      status: 'valid',
      principal: expectedPrincipal,
      renewal: { token: TOKEN, maxAgeSeconds: 14 * SECONDS_PER_DAY },
    });
    expect(recorded.deleted).toEqual([]);
  });

  test('メールアドレスが未確認の利用者のセッションも有効にする', async () => {
    const { verifier } = setup(
      sessionOf({ user: { emailVerifiedAt: null } }),
      after(ISSUED_AT, 60),
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'valid', principal: expectedPrincipal });
  });
});

describe('UserSessionVerifier の束縛', () => {
  test('主体別の振り分けの利用者の検証として、コンテナから解決して使える', async () => {
    const recorded: Recorded = { lookups: [], touched: [], deleted: [] };
    const container = new Container();
    container
      .bind<SecretIssuer>(AUTH_TYPES.SecretIssuer)
      .toConstantValue(createSecretIssuer());
    container
      .bind<UserSessionStore>(IDENTITY_TYPES.UserSessionStore)
      .toConstantValue(createStore(sessionOf(), recorded));
    container
      .bind<Clock>(PLATFORM_TYPES.Clock)
      .toConstantValue({ now: () => after(ISSUED_AT, 60) });
    container
      .bind<SubjectSessionVerifierPort>(AUTH_TYPES.UserSessionVerifier)
      .to(UserSessionVerifier);
    container
      .bind<SubjectSessionVerifierPort>(AUTH_TYPES.AdminSessionVerifier)
      .to(InvalidSubjectSessionVerifier);
    container.bind(SubjectSessionVerifier).toSelf();

    const verifier = container.get(SubjectSessionVerifier);

    expect(
      await verifier.verify({ subjectKind: 'user', token: TOKEN }),
    ).toEqual({ status: 'valid', principal: expectedPrincipal });
    expect(
      await verifier.verify({ subjectKind: 'admin', token: TOKEN }),
    ).toEqual({ status: 'invalid' });
  });
});
