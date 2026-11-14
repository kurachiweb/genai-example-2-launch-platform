import type { UserAccountView } from '../../../lib/core/identity/account-guard.ts';
import type { DisposableEmailStatus } from '../../../lib/core/identity/disposable-email.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';
import type {
  SessionPolicy,
  SessionTimes,
} from '../../domain/auth/session-policy.ts';
import type { AuthTokenPurpose } from '../../domain/identity/auth-token-purpose.ts';
import type { UserAccountSnapshot } from '../../domain/identity/user-account.ts';
import type { RequestMeta } from './request-meta.ts';

export interface UserRecord extends UserAccountView {
  readonly passwordHash: string;
  readonly disposableEmailStatus: DisposableEmailStatus | null;
  readonly termsAgreedAt: Date;
  readonly lifecycleVersion: number;
}

export interface NewUserRecord {
  readonly id: string;
  readonly pseudonymousId: string;
  // 前後の空白を除いた入力
  readonly email: string;
  readonly passwordHash: string;
  // 前後の空白を除いた入力
  readonly nickname: string;
  readonly handle: string;
  readonly termsAgreedAt: Date;
}

export interface NewAuthToken {
  readonly userId: string;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  // email_changeだけ
  readonly newEmail?: string;
  // password_changeだけ
  readonly pendingPasswordHash?: string;
}

export interface ConsumedAuthToken {
  readonly userId: string;
  readonly newEmail: string | null;
  readonly pendingPasswordHash: string | null;
}

export interface NewSessionRecord extends SessionTimes {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly userAgent: string | null;
}

export type StoredSession = NewSessionRecord;

export interface UserAccountStore {
  // 退会済みも返す
  findById(userId: string): Promise<UserRecord | undefined>;
  // 大文字小文字を区別しない
  findNotWithdrawnByEmail(email: string): Promise<UserRecord | undefined>;
  // 未退会の利用者の中で調べる
  isEmailInUse(email: string, exceptUserId?: string): Promise<boolean>;
  // 1つの一括の書き込みで作る。使い捨て判定は判定の日時を持たない「未判定」にする
  createWithVerification(
    user: NewUserRecord,
    token: NewAuthToken,
    session: NewSessionRecord,
  ): Promise<'created' | 'email-in-use' | 'handle-in-use'>;
  // 確認済みの更新と、同じ利用者の未使用の確認のトークンの削除を1つの一括の書き込みで行う
  markEmailVerified(userId: string, at: Date): Promise<void>;
  saveDisposableStatus(
    userId: string,
    status: DisposableEmailStatus,
    at: Date,
  ): Promise<void>;
  // 更新・確認済み・全セッションとリセット・変更のトークンの削除を1つの一括の書き込みで行う
  applyPasswordReset(
    userId: string,
    passwordHash: string,
    at: Date,
  ): Promise<void>;
  // 更新・確認済み・使い捨て判定の「未判定」への差し戻し(判定の日時は消す)・全セッションと確認・変更のトークンの削除を1つの一括の書き込みで行う
  applyEmailChange(
    userId: string,
    newEmail: string,
    at: Date,
  ): Promise<'changed' | 'email-in-use'>;
  // 更新・全セッションと変更のトークンの削除を1つの一括の書き込みで行う
  applyPasswordChange(userId: string, passwordHash: string): Promise<void>;
  // 確認済みで未退会の「未判定」の利用者のうち、判定の日時(まだ判定していなければ確認の日時)がcheckedBeforeより前の利用者
  listUndetermined(
    checkedBefore: Date,
    limit: number,
  ): Promise<readonly string[]>;
}

export interface UserSessionStore {
  insert(session: NewSessionRecord): Promise<void>;
  findByTokenHash(
    tokenHash: string,
  ): Promise<
    (StoredSession & { readonly user: UserAccountSnapshot }) | undefined
  >;
  touch(sessionId: string, at: Date): Promise<void>;
  listByUser(userId: string): Promise<readonly StoredSession[]>;
  deleteOne(userId: string, sessionId: string): Promise<boolean>;
  deleteOthers(userId: string, keepSessionId: string): Promise<number>;
  // アイドルまたは絶対の期限切れを削除する
  deleteExpired(now: Date, policy: SessionPolicy): Promise<number>;
}

export interface AuthTokenStore {
  // 同じ利用者・用途の未使用を消してから加えることを1つの一括の書き込みで行う
  replace(token: NewAuthToken): Promise<void>;
  // 消費せずに読む
  findValid(
    purpose: AuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAuthToken | undefined>;
  // 期限内なら1文で削除して返すため、同じトークンの2回目は見つからない
  consume(
    purpose: AuthTokenPurpose,
    tokenHash: string,
    now: Date,
  ): Promise<ConsumedAuthToken | undefined>;
  deleteExpired(now: Date): Promise<number>;
}

export interface NewLoginChallenge {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface LoginChallengeStore {
  insert(challenge: NewLoginChallenge): Promise<void>;
  findValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly userId: string } | undefined>;
  delete(id: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface TotpCredential {
  readonly sealedSecret: string;
  readonly enabledAt: Date | null;
  readonly pendingExpiresAt: Date | null;
  readonly lastUsedStep: number | null;
}

export interface TotpCredentialStore {
  find(userId: string): Promise<TotpCredential | undefined>;
  savePending(
    userId: string,
    sealedSecret: string,
    expiresAt: Date,
  ): Promise<'saved' | 'already-enabled'>;
  // 有効化・リカバリコードの追加・全セッションの削除を1つの一括の書き込みで行う。保留の秘密鍵がsealedSecretと異なれば何もしない
  enableRevokingSessions(
    userId: string,
    sealedSecret: string,
    step: number,
    at: Date,
    recoveryHashes: readonly string[],
  ): Promise<'enabled' | 'not-pending'>;
  // 使用済みの時間窓より新しいときだけ更新し、同じ時間窓の認証コードの再使用を拒否する
  advanceStep(userId: string, step: number): Promise<boolean>;
  // 秘密鍵とリカバリコードの削除・全セッションの削除を1つの一括の書き込みで行う。有効でなければ何もしない
  disableRevokingSessions(userId: string): Promise<'disabled' | 'not-enabled'>;
  deleteExpiredPending(now: Date): Promise<number>;
}

export interface RecoveryCodeStore {
  // 一致すれば削除する
  consume(userId: string, codeHash: string): Promise<boolean>;
  count(userId: string): Promise<number>;
  // 未使用のコードの置き換え・全セッションの削除を1つの一括の書き込みで行う。多要素認証が有効でなければ何もしない
  replaceAllRevokingSessions(
    userId: string,
    hashes: readonly string[],
  ): Promise<'replaced' | 'not-enabled'>;
}

export interface HandleAvailability {
  // 既定の実装は、退会後に物理削除されていない利用者を含むすべての行と大文字小文字を区別せずに比べる
  isAvailable(handle: string): Promise<boolean>;
}

export interface DeviceDescription {
  readonly browserName: string | null;
  readonly osName: string | null;
}

export interface DeviceDescriber {
  describe(userAgent: string | null): DeviceDescription;
}

export interface IdentityMailer {
  sendEmailVerification(
    to: UserAccountView,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  sendEmailChangeConfirmation(
    user: UserRecord,
    newEmail: string,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  sendEmailChanged(
    previousEmail: string,
    user: UserRecord,
    at: Date,
  ): Promise<void>;
  sendPasswordReset(
    user: UserRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  sendPasswordResetCompleted(user: UserRecord, at: Date): Promise<void>;
  sendPasswordChangeConfirmation(
    user: UserRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  sendPasswordChanged(user: UserRecord, at: Date): Promise<void>;
}

export interface IdentitySettings {
  // CLIENT_SITE_ORIGIN
  readonly clientOrigin: string;
  readonly totpIssuer: string;
}

export interface UserStateTransition {
  readonly kind: 'withdraw' | 'suspend' | 'unsuspend';
  readonly userId: string;
  readonly expectedVersion: number;
  readonly at: Date;
}

export interface UserLifecycleCommitter {
  // 読み取った版が古ければ何も確定せず、AppError(conflict, account_state_conflict)を投げる
  commit(transition: UserStateTransition): Promise<UserLifecycleEvent>;
}

export interface IdentityPublishOptions {
  readonly delaySeconds?: number;
}

// application層は共通ライブラリのworkersの送信部品を読み込めないため、PLATFORM_TYPES.MessagePublisherに束縛された部品をこの形で受け取る
export interface IdentityMessagePublisher {
  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
    options?: IdentityPublishOptions,
  ): Promise<string>;
}

export type LimitedMailKind =
  'email_verification' | 'email_change' | 'password_reset';

export interface MailSendLimits {
  // 宛先とIPアドレスのどちらかが上限を超えたら、AppError(rate_limited, rate_limit_exceeded)を投げる
  consume(
    kind: LimitedMailKind,
    address: string,
    meta: RequestMeta,
  ): Promise<void>;
}
