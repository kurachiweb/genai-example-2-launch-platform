import { inject, injectable } from 'inversify';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { checkAccountWritable } from '../../domain/identity/user-account.ts';
import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import type { SessionView } from '../session/session-view.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type { UserAccountStore, UserRecord } from './ports.ts';

export interface CurrentUser {
  readonly principal: AuthenticatedPrincipal;
  readonly user: UserRecord;
}

export interface AccountGuard {
  // 未ログイン・利用者以外の主体・退会済みならundefined
  currentUser(session: SessionView): Promise<CurrentUser | undefined>;
  // 停止中でも通す(閲覧・ログアウト・セッションの失効・退会のため)
  requireUser(session: SessionView): Promise<CurrentUser>;
  requireWritableUser(session: SessionView): Promise<CurrentUser>;
  requireVerifiedUser(session: SessionView): Promise<CurrentUser>;
}

const UNAUTHENTICATED_MESSAGE = 'ログインが必要です。';

const ACCOUNT_UNAVAILABLE_MESSAGE =
  'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。';

const EMAIL_NOT_VERIFIED_MESSAGE =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

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
    return { principal, user };
  }

  async requireUser(session: SessionView): Promise<CurrentUser> {
    const current = await this.currentUser(session);
    if (current === undefined) {
      throw new AppError({
        kind: 'unauthenticated',
        code: 'unauthenticated',
        message: UNAUTHENTICATED_MESSAGE,
      });
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
      throw new AppError({
        kind: 'forbidden',
        code: 'email_not_verified',
        message: EMAIL_NOT_VERIFIED_MESSAGE,
      });
    }
    if (denial !== undefined) {
      throw new AppError({
        kind: 'forbidden',
        code: 'account_unavailable',
        message: ACCOUNT_UNAVAILABLE_MESSAGE,
      });
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
