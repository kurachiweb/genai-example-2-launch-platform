import { inject, injectable } from 'inversify';

import {
  ADMIN_ROLES,
  type AdminRole,
  hasRole,
} from '../../../common-lib/admin/admin-roles.ts';
import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import type { SessionView } from '../session/session-view.ts';
import { adminError } from './admin-errors.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type { AdminAccountStore, AdminRecord } from './ports.ts';

const ADMIN_CALLER = 'admin';

export interface CurrentAdmin {
  readonly id: string;
  readonly role: AdminRole;
  readonly nickname: string;
  readonly sessionId: string;
}

// application層はpresentation層のCallerKindを読み込めないため、呼び出し元は文字列で受け取る
export interface AdminAuthorizer {
  // 管理者側でない呼び出し元とロール不足はforbidden、管理者のセッションで認証されていなければunauthenticated
  requireAdmin(
    session: SessionView,
    caller: string,
    minimum: AdminRole,
  ): Promise<CurrentAdmin>;
  // 対象の所有者本人なら最低限のロールを求めない
  requireSelfOrRole(
    session: SessionView,
    caller: string,
    ownerAdminId: string,
    minimum: AdminRole,
  ): Promise<CurrentAdmin>;
}

// hasRoleは型の外の最低限のロールを最も低いロールより下に並べて許可側に倒すため、判定の前に拒む
function assertKnownRole(minimum: AdminRole): void {
  if (!ADMIN_ROLES.includes(minimum)) {
    throw new Error(`最低限のロールに未定義の値が指定されました: ${minimum}`);
  }
}

// 処理単位のコンテナで単一に束縛し、同じ要求の中では保存済みのロールを1回だけ読む。次の要求では読み直すため、ロールの変更がすぐに反映される
@injectable()
export class StoreAdminAuthorizer implements AdminAuthorizer {
  readonly #reads = new Map<string, Promise<AdminRecord | undefined>>();

  constructor(
    @inject(ADMIN_TYPES.AdminAccountStore)
    private readonly admins: AdminAccountStore,
  ) {}

  async requireAdmin(
    session: SessionView,
    caller: string,
    minimum: AdminRole,
  ): Promise<CurrentAdmin> {
    assertKnownRole(minimum);
    const current = await this.#authenticate(session, caller);
    if (!hasRole(current.role, minimum)) {
      throw adminError('forbidden');
    }
    return current;
  }

  async requireSelfOrRole(
    session: SessionView,
    caller: string,
    ownerAdminId: string,
    minimum: AdminRole,
  ): Promise<CurrentAdmin> {
    assertKnownRole(minimum);
    const current = await this.#authenticate(session, caller);
    if (current.id !== ownerAdminId && !hasRole(current.role, minimum)) {
      throw adminError('forbidden');
    }
    return current;
  }

  async #authenticate(
    session: SessionView,
    caller: string,
  ): Promise<CurrentAdmin> {
    if (caller !== ADMIN_CALLER) {
      throw adminError('forbidden');
    }
    const principal = await session.principal();
    if (
      principal.kind !== 'authenticated' ||
      principal.subjectKind !== 'admin'
    ) {
      throw adminError('unauthenticated');
    }
    const admin = await this.#read(principal.subjectId);
    if (admin?.status !== 'active') {
      throw adminError('unauthenticated');
    }
    return toCurrentAdmin(admin, principal);
  }

  #read(adminId: string): Promise<AdminRecord | undefined> {
    const cached = this.#reads.get(adminId);
    if (cached !== undefined) {
      return cached;
    }
    const read = this.admins.findById(adminId);
    this.#reads.set(adminId, read);
    return read;
  }
}

function toCurrentAdmin(
  admin: AdminRecord,
  principal: AuthenticatedPrincipal,
): CurrentAdmin {
  // 有効化はニックネームの仮の保存を条件にするため、有効な管理者にニックネームが無いのはデータの不整合である
  if (admin.nickname === null) {
    throw new Error('有効な管理者にニックネームがありません');
  }
  return {
    id: admin.id,
    role: admin.role,
    nickname: admin.nickname,
    sessionId: principal.sessionId,
  };
}
