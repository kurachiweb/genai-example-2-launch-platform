import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type {
  HashPurpose,
  KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { AdminSnapshot } from '../../domain/admin/admin-account.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import {
  HashingSecretIssuer,
  type SecretIssuer,
} from '../auth/secret-issuer.ts';
import {
  InvalidSubjectSessionVerifier,
  SubjectSessionVerifier,
  type SubjectSessionVerifierPort,
} from '../auth/subject-session-verifier.ts';
import { AdminSessionVerifier } from './admin-session-verifier.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type { AdminSessionStore, StoredAdminSession } from './ports.ts';

const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
const TOKEN_HASH = `hashed(admin-session):${TOKEN}`;
const ADMIN_ID = '01JADMIN000000000000000000';
const SESSION_ID = '01JASESSION000000000000000';
const ISSUED_AT = new Date('2026-11-01T00:00:00.000Z');
const MS_PER_SECOND = 1000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;

type FoundSession = StoredAdminSession & { readonly admin: AdminSnapshot };

interface Recorded {
  readonly lookups: string[];
  readonly touched: { sessionId: string; at: Date }[];
  readonly deleted: { adminId: string; sessionId: string }[];
}

function createStore(
  found: FoundSession | undefined,
  recorded: Recorded,
): AdminSessionStore {
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
    deleteOne(adminId, sessionId) {
      recorded.deleted.push({ adminId, sessionId });
      return Promise.resolve(true);
    },
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

const after = (base: Date, seconds: number): Date =>
  new Date(base.getTime() + seconds * MS_PER_SECOND);

function sessionOf(
  overrides: {
    readonly lastUsedAt?: Date;
    readonly admin?: Partial<AdminSnapshot>;
  } = {},
): FoundSession {
  return {
    id: SESSION_ID,
    adminId: ADMIN_ID,
    tokenHash: TOKEN_HASH,
    userAgent: 'Mozilla/5.0',
    createdAt: ISSUED_AT,
    lastUsedAt: overrides.lastUsedAt ?? ISSUED_AT,
    absoluteExpiresAt: after(ISSUED_AT, 12 * HOUR_SECONDS),
    admin: {
      id: ADMIN_ID,
      role: 'viewer',
      status: 'active',
      invitationExpiresAt: null,
      ...overrides.admin,
    },
  };
}

function setup(found: FoundSession | undefined, now: Date) {
  const recorded: Recorded = { lookups: [], touched: [], deleted: [] };
  const clock: Clock = { now: () => now };
  const verifier = new AdminSessionVerifier(
    createSecretIssuer(),
    createStore(found, recorded),
    clock,
  );
  return { verifier, recorded };
}

const expectedPrincipal = {
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: ADMIN_ID,
  sessionId: SESSION_ID,
} as const;

const DELETED_SESSION = [{ adminId: ADMIN_ID, sessionId: SESSION_ID }];

describe('AdminSessionVerifier の無効', () => {
  test('用途admin-sessionのハッシュで探し、無ければ無効にして何も消さない', async () => {
    const { verifier, recorded } = setup(undefined, after(ISSUED_AT, 60));

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.lookups).toEqual([TOKEN_HASH]);
    expect(recorded.deleted).toEqual([]);
    expect(recorded.touched).toEqual([]);
  });

  test('管理者が招待中ならセッションを削除して無効にする', async () => {
    const { verifier, recorded } = setup(
      sessionOf({
        admin: {
          status: 'invited',
          invitationExpiresAt: after(ISSUED_AT, 24 * HOUR_SECONDS),
        },
      }),
      after(ISSUED_AT, 60),
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.deleted).toEqual(DELETED_SESSION);
    expect(recorded.touched).toEqual([]);
  });

  test('最後の利用からアイドルの1時間ちょうどで期限切れとして削除し、無効にする', async () => {
    const lastUsedAt = after(ISSUED_AT, 2 * HOUR_SECONDS);
    const { verifier, recorded } = setup(
      sessionOf({ lastUsedAt }),
      after(lastUsedAt, HOUR_SECONDS),
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.deleted).toEqual(DELETED_SESSION);
    expect(recorded.touched).toEqual([]);
  });

  test('発行から絶対の12時間ちょうどで、利用が続いていても期限切れとして削除し、無効にする', async () => {
    const now = after(ISSUED_AT, 12 * HOUR_SECONDS);
    const { verifier, recorded } = setup(
      sessionOf({ lastUsedAt: after(now, -60) }),
      now,
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'invalid' });
    expect(recorded.deleted).toEqual(DELETED_SESSION);
  });
});

describe('AdminSessionVerifier の有効', () => {
  test('最後の更新から5分未満なら更新せず、延長の指示も付けない', async () => {
    const { verifier, recorded } = setup(
      sessionOf(),
      after(ISSUED_AT, 5 * MINUTE_SECONDS - 1),
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({ status: 'valid', principal: expectedPrincipal });
    expect(recorded.touched).toEqual([]);
    expect(recorded.deleted).toEqual([]);
  });

  test('最後の更新から5分以上なら最終利用日時を更新し、同じトークンとアイドル期限までの有効期間で延長を指示する', async () => {
    const now = after(ISSUED_AT, 5 * MINUTE_SECONDS);
    const { verifier, recorded } = setup(sessionOf(), now);

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({
      status: 'valid',
      principal: expectedPrincipal,
      renewal: { token: TOKEN, maxAgeSeconds: HOUR_SECONDS },
    });
    expect(recorded.touched).toEqual([{ sessionId: SESSION_ID, at: now }]);
  });

  test('延長の有効期間は絶対期限が先に来るならそこまでに縮める', async () => {
    const now = after(ISSUED_AT, 11 * HOUR_SECONDS + 30 * MINUTE_SECONDS);
    const { verifier } = setup(
      sessionOf({ lastUsedAt: after(now, -10 * MINUTE_SECONDS) }),
      now,
    );

    const result = await verifier.verify(TOKEN);

    expect(result).toEqual({
      status: 'valid',
      principal: expectedPrincipal,
      renewal: { token: TOKEN, maxAgeSeconds: 30 * MINUTE_SECONDS },
    });
  });

  test.each(['viewer', 'moderator', 'super_admin'] as const)(
    'ロール(%s)によらず有効な管理者の主体を返す',
    async (role) => {
      const { verifier } = setup(
        sessionOf({ admin: { role } }),
        after(ISSUED_AT, 60),
      );

      const result = await verifier.verify(TOKEN);

      expect(result).toEqual({ status: 'valid', principal: expectedPrincipal });
    },
  );
});

describe('AdminSessionVerifier の束縛', () => {
  test('主体別の振り分けの管理者の検証として解決でき、利用者側の呼び出しでは使われない', async () => {
    const recorded: Recorded = { lookups: [], touched: [], deleted: [] };
    const container = new Container();
    container
      .bind<SecretIssuer>(AUTH_TYPES.SecretIssuer)
      .toConstantValue(createSecretIssuer());
    container
      .bind<AdminSessionStore>(ADMIN_TYPES.AdminSessionStore)
      .toConstantValue(createStore(sessionOf(), recorded));
    container
      .bind<Clock>(PLATFORM_TYPES.Clock)
      .toConstantValue({ now: () => after(ISSUED_AT, 60) });
    container
      .bind<SubjectSessionVerifierPort>(ADMIN_TYPES.AdminSessionVerifier)
      .to(AdminSessionVerifier);
    container
      .bind<SubjectSessionVerifierPort>(AUTH_TYPES.AdminSessionVerifier)
      .toService(ADMIN_TYPES.AdminSessionVerifier);
    container
      .bind<SubjectSessionVerifierPort>(AUTH_TYPES.UserSessionVerifier)
      .to(InvalidSubjectSessionVerifier);
    container.bind(SubjectSessionVerifier).toSelf();

    const verifier = container.get(SubjectSessionVerifier);

    expect(
      await verifier.verify({ subjectKind: 'admin', token: TOKEN }),
    ).toEqual({ status: 'valid', principal: expectedPrincipal });
    expect(
      await verifier.verify({ subjectKind: 'user', token: TOKEN }),
    ).toEqual({ status: 'invalid' });
    expect(recorded.lookups).toEqual([TOKEN_HASH]);
  });
});
