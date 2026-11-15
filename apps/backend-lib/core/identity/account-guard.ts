import type {
  AuthenticatedPrincipal,
  SessionView,
} from '../session/session-view.ts';

// 別の機能のユースケースへも渡す契約のため、パスワードのハッシュなどの秘密情報の項目を持たせない
export interface UserAccountView {
  readonly id: string;
  readonly pseudonymousId: string;
  readonly status: 'active' | 'suspended';
  readonly emailVerifiedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly email: string;
  readonly nickname: string;
  readonly handle: string;
}

export interface CurrentUser {
  readonly principal: AuthenticatedPrincipal;
  readonly user: UserAccountView;
}

export interface AccountGuard {
  // 未ログイン・利用者以外の主体・退会済みならundefined
  currentUser(session: SessionView): Promise<CurrentUser | undefined>;
  // 停止中でも通す(閲覧・ログアウト・セッションの失効・退会のため)
  requireUser(session: SessionView): Promise<CurrentUser>;
  requireWritableUser(session: SessionView): Promise<CurrentUser>;
  requireVerifiedUser(session: SessionView): Promise<CurrentUser>;
}
