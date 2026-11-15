import { describe, expect, test } from 'bun:test';

import type { AdminRole } from '../../../common-lib/admin/admin-roles.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  Principal,
  SessionView,
} from '../../../lib/core/session/session-view.ts';
import {
  type AdminAuthorizer,
  StoreAdminAuthorizer,
} from './admin-authorizer.ts';
import type { AdminAccountStore, AdminRecord } from './ports.ts';

const ADMIN_ID = '01JC0ADMN00000000000000001';
const OTHER_ADMIN_ID = '01JC0ADMN00000000000000002';
const SESSION_ID = '01JC0SESN00000000000000001';
const ACTIVATED_AT = new Date('2026-11-01T00:00:00.000Z');

const ADMIN_PRINCIPAL: Principal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: ADMIN_ID,
  sessionId: SESSION_ID,
});

const FORBIDDEN = {
  kind: 'forbidden',
  code: 'forbidden',
  message: 'この操作はできません。',
} as const;

const UNAUTHENTICATED = {
  kind: 'unauthenticated',
  code: 'unauthenticated',
  message: 'ログインが必要です。',
} as const;

function sessionOf(principal: Principal): SessionView {
  return { principal: () => Promise.resolve(principal) };
}

const ADMIN_SESSION = sessionOf(ADMIN_PRINCIPAL);

function adminOf(overrides: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: ADMIN_ID,
    role: 'viewer',
    status: 'active',
    invitationExpiresAt: null,
    email: 'admin1@mail.example',
    passwordHash: 'pbkdf2-sha256$test',
    nickname: '管理者1',
    title: null,
    avatarFileId: null,
    createdAt: ACTIVATED_AT,
    activatedAt: ACTIVATED_AT,
    ...overrides,
  };
}

// 保存済みの管理者を差し替えられる偽物。読み取りの回数を数え、ロールの変更を再現できる
function createStore(initial: AdminRecord | undefined): {
  readonly store: AdminAccountStore;
  readonly reads: readonly string[];
  replace(admin: AdminRecord | undefined): void;
} {
  let current = initial;
  const reads: string[] = [];
  const unused = (): never => {
    throw new Error('アクセス制御では使わない');
  };
  return {
    store: {
      findById(adminId) {
        reads.push(adminId);
        return Promise.resolve(current?.id === adminId ? current : undefined);
      },
      findByEmail: unused,
      list: unused,
      findProfiles: unused,
      insertInvited: unused,
      reissueInvitation: unused,
      savePendingProfile: unused,
      activate: unused,
      deleteGuarded: unused,
      changeRoleGuarded: unused,
      updateProfile: unused,
      applyPasswordReset: unused,
      applyEmailChange: unused,
      applyPasswordChange: unused,
    },
    reads,
    replace(admin) {
      current = admin;
    },
  };
}

function setup(admin: AdminRecord | undefined) {
  const fake = createStore(admin);
  const authorizer: AdminAuthorizer = new StoreAdminAuthorizer(fake.store);
  return { authorizer, ...fake };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('拒否されなかった');
}

async function appErrorOf(promise: Promise<unknown>) {
  const error = await rejectionOf(promise);
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorで拒否されなかった', { cause: error });
  }
  return { kind: error.kind, code: error.code, message: error.message };
}

function currentAdminOf(role: AdminRole): CurrentAdmin {
  return { id: ADMIN_ID, role, nickname: '管理者1', sessionId: SESSION_ID };
}

const ROLE_MATRIX: readonly (readonly [AdminRole, AdminRole, boolean])[] = [
  ['viewer', 'viewer', true],
  ['viewer', 'moderator', false],
  ['viewer', 'super_admin', false],
  ['moderator', 'viewer', true],
  ['moderator', 'moderator', true],
  ['moderator', 'super_admin', false],
  ['super_admin', 'viewer', true],
  ['super_admin', 'moderator', true],
  ['super_admin', 'super_admin', true],
];

const NOT_ADMIN_CALLERS = ['client', 'internal', '', 'ADMIN'] as const;

const NOT_ADMIN_PRINCIPALS: readonly (readonly [string, Principal])[] = [
  ['未ログイン', { kind: 'anonymous' }],
  [
    '利用者の主体',
    {
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: ADMIN_ID,
      sessionId: SESSION_ID,
    },
  ],
];

// 型の外の値はhasRoleで最も低いロールより下に並び、どのロールでも許可側に倒れるため、実行時に拒む
const OUT_OF_TYPE_ROLES = ['owner', '', 'VIEWER'] as unknown as AdminRole[];

describe('StoreAdminAuthorizer.requireAdmin', () => {
  test.each(ROLE_MATRIX)(
    '保存済みのロールが%sの管理者に最低限のロール%sを求めると、許可=%s',
    async (role, minimum, allowed) => {
      const { authorizer } = setup(adminOf({ role }));

      const result = authorizer.requireAdmin(ADMIN_SESSION, 'admin', minimum);

      if (allowed) {
        expect(await result).toEqual(currentAdminOf(role));
      } else {
        expect(await appErrorOf(result)).toEqual(FORBIDDEN);
      }
    },
  );

  test.each(NOT_ADMIN_CALLERS)(
    '呼び出し元が管理者側でない(%p)なら、セッションと管理者を読まずに禁止する',
    async (caller) => {
      const { authorizer, reads } = setup(adminOf({ role: 'super_admin' }));
      let principalReads = 0;
      const session: SessionView = {
        principal: () => {
          principalReads += 1;
          return Promise.resolve(ADMIN_PRINCIPAL);
        },
      };

      const error = await appErrorOf(
        authorizer.requireAdmin(session, caller, 'viewer'),
      );

      expect(error).toEqual(FORBIDDEN);
      expect(principalReads).toBe(0);
      expect(reads).toEqual([]);
    },
  );

  test.each(NOT_ADMIN_PRINCIPALS)(
    '%sなら管理者を読まずに未認証にする',
    async (_label, principal) => {
      const { authorizer, reads } = setup(adminOf({ role: 'super_admin' }));

      const error = await appErrorOf(
        authorizer.requireAdmin(sessionOf(principal), 'admin', 'viewer'),
      );

      expect(error).toEqual(UNAUTHENTICATED);
      expect(reads).toEqual([]);
    },
  );

  test('管理者が見つからなければ未認証にする', async () => {
    const { authorizer } = setup(undefined);

    expect(
      await appErrorOf(
        authorizer.requireAdmin(ADMIN_SESSION, 'admin', 'viewer'),
      ),
    ).toEqual(UNAUTHENTICATED);
  });

  test('招待中の管理者なら最上位管理者でも未認証にする', async () => {
    const { authorizer } = setup(
      adminOf({ role: 'super_admin', status: 'invited', nickname: null }),
    );

    expect(
      await appErrorOf(
        authorizer.requireAdmin(ADMIN_SESSION, 'admin', 'viewer'),
      ),
    ).toEqual(UNAUTHENTICATED);
  });

  test('有効な管理者にニックネームが無ければ、データの不整合として例外にする', async () => {
    const { authorizer } = setup(adminOf({ nickname: null }));

    const error = await rejectionOf(
      authorizer.requireAdmin(ADMIN_SESSION, 'admin', 'viewer'),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
  });

  test.each(OUT_OF_TYPE_ROLES)(
    '最低限のロールに型の外の値(%p)を渡すと、最上位管理者でも許可せず、管理者を読まずに例外にする',
    async (minimum) => {
      const { authorizer, reads } = setup(adminOf({ role: 'super_admin' }));

      const error = await rejectionOf(
        authorizer.requireAdmin(ADMIN_SESSION, 'admin', minimum),
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
      expect(reads).toEqual([]);
    },
  );

  test('保存済みのロールが型の外の値なら、閲覧のみを求める操作でも禁止する', async () => {
    const { authorizer } = setup(
      adminOf({ role: 'owner' as unknown as AdminRole }),
    );

    expect(
      await appErrorOf(
        authorizer.requireAdmin(ADMIN_SESSION, 'admin', 'viewer'),
      ),
    ).toEqual(FORBIDDEN);
  });
});

describe('StoreAdminAuthorizer.requireSelfOrRole', () => {
  test('対象の所有者本人なら、最低限のロールに満たなくても許可する', async () => {
    const { authorizer } = setup(adminOf({ role: 'viewer' }));

    expect(
      await authorizer.requireSelfOrRole(
        ADMIN_SESSION,
        'admin',
        ADMIN_ID,
        'super_admin',
      ),
    ).toEqual(currentAdminOf('viewer'));
  });

  test.each(ROLE_MATRIX)(
    '本人でなければ、保存済みのロール%sに最低限のロール%sを求め、許可=%s',
    async (role, minimum, allowed) => {
      const { authorizer } = setup(adminOf({ role }));

      const result = authorizer.requireSelfOrRole(
        ADMIN_SESSION,
        'admin',
        OTHER_ADMIN_ID,
        minimum,
      );

      if (allowed) {
        expect(await result).toEqual(currentAdminOf(role));
      } else {
        expect(await appErrorOf(result)).toEqual(FORBIDDEN);
      }
    },
  );

  test.each(NOT_ADMIN_CALLERS)(
    '呼び出し元が管理者側でない(%p)なら、本人でも禁止する',
    async (caller) => {
      const { authorizer, reads } = setup(adminOf());

      const error = await appErrorOf(
        authorizer.requireSelfOrRole(ADMIN_SESSION, caller, ADMIN_ID, 'viewer'),
      );

      expect(error).toEqual(FORBIDDEN);
      expect(reads).toEqual([]);
    },
  );

  test.each(NOT_ADMIN_PRINCIPALS)(
    '%sなら対象のIDが主体のIDと同じでも未認証にする',
    async (_label, principal) => {
      const { authorizer } = setup(adminOf());

      expect(
        await appErrorOf(
          authorizer.requireSelfOrRole(
            sessionOf(principal),
            'admin',
            ADMIN_ID,
            'viewer',
          ),
        ),
      ).toEqual(UNAUTHENTICATED);
    },
  );

  test('招待中の管理者なら本人の対象でも未認証にする', async () => {
    const { authorizer } = setup(
      adminOf({ status: 'invited', nickname: null }),
    );

    expect(
      await appErrorOf(
        authorizer.requireSelfOrRole(
          ADMIN_SESSION,
          'admin',
          ADMIN_ID,
          'viewer',
        ),
      ),
    ).toEqual(UNAUTHENTICATED);
  });

  test.each(OUT_OF_TYPE_ROLES)(
    '最低限のロールに型の外の値(%p)を渡すと、本人の対象でも例外にする',
    async (minimum) => {
      const { authorizer } = setup(adminOf());

      const error = await rejectionOf(
        authorizer.requireSelfOrRole(ADMIN_SESSION, 'admin', ADMIN_ID, minimum),
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
    },
  );
});

describe('StoreAdminAuthorizer の要求ごとの読み取り', () => {
  test('同じ要求の中では、判定を何度行っても保存済みのロールを1回だけ読む', async () => {
    const { authorizer, reads } = setup(adminOf({ role: 'moderator' }));

    await Promise.all([
      authorizer.requireAdmin(ADMIN_SESSION, 'admin', 'viewer'),
      authorizer.requireAdmin(ADMIN_SESSION, 'admin', 'moderator'),
    ]);
    await authorizer.requireSelfOrRole(
      ADMIN_SESSION,
      'admin',
      OTHER_ADMIN_ID,
      'moderator',
    );

    expect(reads).toEqual([ADMIN_ID]);
  });

  test('同じ要求の中では読んだロールで判定し、次の要求では変更後の保存済みのロールで判定する', async () => {
    const fake = createStore(adminOf({ role: 'viewer' }));
    const firstRequest = new StoreAdminAuthorizer(fake.store);
    expect(
      await appErrorOf(
        firstRequest.requireAdmin(ADMIN_SESSION, 'admin', 'moderator'),
      ),
    ).toEqual(FORBIDDEN);

    fake.replace(adminOf({ role: 'moderator' }));

    expect(
      await appErrorOf(
        firstRequest.requireAdmin(ADMIN_SESSION, 'admin', 'moderator'),
      ),
    ).toEqual(FORBIDDEN);
    const nextRequest = new StoreAdminAuthorizer(fake.store);
    expect(
      await nextRequest.requireAdmin(ADMIN_SESSION, 'admin', 'moderator'),
    ).toEqual(currentAdminOf('moderator'));
    expect(fake.reads).toEqual([ADMIN_ID, ADMIN_ID]);
  });
});
