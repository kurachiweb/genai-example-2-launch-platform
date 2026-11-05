import { inject, injectable } from 'inversify';

import type {
  AccountGuard,
  CurrentUser,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import { checkAccountWritable } from '../../domain/identity/user-account.ts';
import { identityError } from './identity-errors.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type { UserAccountStore, UserRecord } from './ports.ts';

// 別の機能へも渡すため、保存済みの記録からパスワードのハッシュや版を除いた読み取りの形だけを詰め直す。戻り値の型の注記により、項目の漏れと余分な項目は型検査で検出される
const toUserAccountView = (user: UserRecord): UserAccountView => ({
  id: user.id,
  pseudonymousId: user.pseudonymousId,
  status: user.status,
  emailVerifiedAt: user.emailVerifiedAt,
  deletedAt: user.deletedAt,
  email: user.email,
  nickname: user.nickname,
  handle: user.handle,
});

// 処理単位のコンテナで単一に束縛し、同じ要求の中では利用者を1回だけ読む
@injectable()
export class StoreAccountGuard implements AccountGuard {
  readonly #reads = new Map<string, Promise<UserRecord | undefined>>();

  constructor(
    @inject(IDENTITY_TYPES.UserAccountStore)
    private readonly users: UserAccountStore,
  ) {}

  async currentUser(session: SessionView): Promise<CurrentUser | undefined> {
    const principal = await session.principal();
    if (
      principal.kind !== 'authenticated' ||
      principal.subjectKind !== 'user'
    ) {
      return undefined;
    }
    const user = await this.#read(principal.subjectId);
    if (user === undefined || user.deletedAt !== null) {
      return undefined;
    }
    return { principal, user: toUserAccountView(user) };
  }

  async requireUser(session: SessionView): Promise<CurrentUser> {
    const current = await this.currentUser(session);
    if (current === undefined) {
      throw identityError('unauthenticated');
    }
    return current;
  }

  requireWritableUser(session: SessionView): Promise<CurrentUser> {
    return this.#requireWritable(session, false);
  }

  requireVerifiedUser(session: SessionView): Promise<CurrentUser> {
    return this.#requireWritable(session, true);
  }

  async #requireWritable(
    session: SessionView,
    requireVerifiedEmail: boolean,
  ): Promise<CurrentUser> {
    const current = await this.requireUser(session);
    const denial = checkAccountWritable(current.user, { requireVerifiedEmail });
    if (denial === 'email-not-verified') {
      throw identityError('email_not_verified');
    }
    if (denial !== undefined) {
      throw identityError('account_unavailable');
    }
    return current;
  }

  #read(userId: string): Promise<UserRecord | undefined> {
    const cached = this.#reads.get(userId);
    if (cached !== undefined) {
      return cached;
    }
    const read = this.users.findById(userId);
    this.#reads.set(userId, read);
    return read;
  }
}
