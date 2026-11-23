import { adminAuthTokens } from '../../../../../db/schema/admin/admin-auth-tokens.ts';
import { adminLoginChallenges } from '../../../../../db/schema/admin/admin-login-challenges.ts';
import { adminSessions } from '../../../../../db/schema/admin/admin-sessions.ts';
import { adminTotpCredentials } from '../../../../../db/schema/admin/admin-totp-credentials.ts';
import { userAuthTokens } from '../../../../../db/schema/identity/user-auth-tokens.ts';
import { userLoginChallenges } from '../../../../../db/schema/identity/user-login-challenges.ts';
import { userSessions } from '../../../../../db/schema/identity/user-sessions.ts';
import { userTotpCredentials } from '../../../../../db/schema/identity/user-totp-credentials.ts';
import {
  adminAt,
  baseInstantOf,
  userAt,
  type EntityContext,
} from '../../entities.ts';
import { deterministicUlid } from '../../random.ts';
import {
  insertStatements,
  type SqlRow,
  type SqlStatement,
} from '../../sql-writer.ts';
import { ADMIN_COUNT } from '../moderation.ts';
import { DAY_MS, scaledCount } from './scale.ts';

const USER_SESSIONS = 3_000;

const USER_AUTH_TOKENS = 3_000;

const USER_LOGIN_CHALLENGES = 1_000;

const USER_TOTP_PENDINGS = 500;

// 管理者のジョブは対象ごとに1回500件までのため、残りが出る件数にする
const ADMIN_PER_TARGET = 600;

const IDLE_AGE_DAYS = 30;

const ABSOLUTE_EXPIRED_DAYS = 20;

const TOKEN_EXPIRED_DAYS = 2;

const UNUSABLE_SECRET = 'synthetic-unusable';

interface Owner {
  readonly id: string;
  readonly createdAt: Date;
}

type OwnerAt = (index: number) => Owner;

function rowsOf(
  entities: EntityContext,
  kind: string,
  count: number,
  ownerAt: OwnerAt,
  columns: (owner: Owner, at: number, index: number) => SqlRow,
): Generator<SqlRow> {
  const base = baseInstantOf(entities.baseDate).getTime();
  return (function* () {
    for (let index = 0; index < count; index += 1) {
      const owner = ownerAt(index);
      const createdAt = new Date(base - (IDLE_AGE_DAYS + 10) * DAY_MS);
      yield {
        id: deterministicUlid(
          createdAt,
          `${String(entities.seed)}:${kind}:${String(index)}`,
        ),
        ...columns(owner, base, index),
        createdAt,
        updatedAt: createdAt,
      };
    }
  })();
}

const tokenHashOf = (kind: string, index: number): string =>
  `synthetic-readiness-${kind}-${String(index + 1).padStart(6, '0')}`;

export function* userCredentialStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  const { profile } = entities;
  const user: OwnerAt = (index) => userAt(entities, index % profile.users);
  yield* insertStatements(
    userSessions,
    rowsOf(
      entities,
      'user-session',
      scaledCount(profile, USER_SESSIONS),
      user,
      (owner, base, index) => ({
        userId: owner.id,
        tokenHash: tokenHashOf('user-session', index),
        lastUsedAt: new Date(base - IDLE_AGE_DAYS * DAY_MS),
        absoluteExpiresAt: new Date(base - ABSOLUTE_EXPIRED_DAYS * DAY_MS),
      }),
    ),
  );
  yield* insertStatements(
    userAuthTokens,
    rowsOf(
      entities,
      'user-auth-token',
      scaledCount(profile, USER_AUTH_TOKENS),
      user,
      (owner, base, index) => ({
        userId: owner.id,
        purpose: 'password_reset',
        tokenHash: tokenHashOf('user-auth-token', index),
        expiresAt: new Date(base - TOKEN_EXPIRED_DAYS * DAY_MS),
      }),
    ),
  );
  yield* insertStatements(
    userLoginChallenges,
    rowsOf(
      entities,
      'user-login-challenge',
      scaledCount(profile, USER_LOGIN_CHALLENGES),
      user,
      (owner, base, index) => ({
        userId: owner.id,
        tokenHash: tokenHashOf('user-login-challenge', index),
        expiresAt: new Date(base - TOKEN_EXPIRED_DAYS * DAY_MS),
      }),
    ),
  );
  yield* insertStatements(
    userTotpCredentials,
    rowsOf(
      entities,
      'user-totp',
      Math.min(scaledCount(profile, USER_TOTP_PENDINGS), profile.users),
      user,
      (owner, base) => ({
        userId: owner.id,
        sealedSecret: UNUSABLE_SECRET,
        pendingExpiresAt: new Date(base - TOKEN_EXPIRED_DAYS * DAY_MS),
      }),
    ),
  );
}

export function* adminCredentialStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  const { profile } = entities;
  const admin: OwnerAt = (index) => adminAt(entities, index % ADMIN_COUNT);
  const count = scaledCount(profile, ADMIN_PER_TARGET);
  yield* insertStatements(
    adminSessions,
    rowsOf(entities, 'admin-session', count, admin, (owner, base, index) => ({
      adminId: owner.id,
      tokenHash: tokenHashOf('admin-session', index),
      lastUsedAt: new Date(base - IDLE_AGE_DAYS * DAY_MS),
      absoluteExpiresAt: new Date(base - ABSOLUTE_EXPIRED_DAYS * DAY_MS),
    })),
  );
  yield* insertStatements(
    adminAuthTokens,
    rowsOf(
      entities,
      'admin-auth-token',
      count,
      admin,
      (owner, base, index) => ({
        adminId: owner.id,
        purpose: 'password_reset',
        tokenHash: tokenHashOf('admin-auth-token', index),
        expiresAt: new Date(base - TOKEN_EXPIRED_DAYS * DAY_MS),
      }),
    ),
  );
  yield* insertStatements(
    adminLoginChallenges,
    rowsOf(
      entities,
      'admin-login-challenge',
      count,
      admin,
      (owner, base, index) => ({
        adminId: owner.id,
        tokenHash: tokenHashOf('admin-login-challenge', index),
        expiresAt: new Date(base - TOKEN_EXPIRED_DAYS * DAY_MS),
      }),
    ),
  );
  yield* insertStatements(
    adminTotpCredentials,
    rowsOf(entities, 'admin-totp', ADMIN_COUNT, admin, (owner, base) => ({
      adminId: owner.id,
      pendingSealedSecret: UNUSABLE_SECRET,
      pendingExpiresAt: new Date(base - TOKEN_EXPIRED_DAYS * DAY_MS),
    })),
  );
}
