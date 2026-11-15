import type { DisposableEmailStatus } from './disposable-email.ts';
import type { UserLifecycleEvent } from './user-lifecycle.ts';

export const USER_LIFECYCLE_EVENT_STATUSES = Object.freeze([
  'pending',
  'completed',
] as const);

export type UserLifecycleEventStatus =
  (typeof USER_LIFECYCLE_EVENT_STATUSES)[number];

export interface StoredLifecycleEvent extends UserLifecycleEvent {
  readonly status: UserLifecycleEventStatus;
  readonly dispatchCount: number;
  readonly lastDispatchedAt: Date;
}

export interface UserLifecycleStore {
  findEvent(eventId: string): Promise<StoredLifecycleEvent | undefined>;
  // 発生日時が同じならIDの昇順で最初のものを返す
  findOldestPending(userId: string): Promise<StoredLifecycleEvent | undefined>;
  completedHandlers(eventId: string): Promise<ReadonlySet<string>>;
  // 同じ波及処理の2回目の記録は無視する
  markHandlerCompleted(
    eventId: string,
    handlerName: string,
    at: Date,
  ): Promise<void>;
  markEventCompleted(eventId: string, at: Date): Promise<void>;
  listStalePending(
    dispatchedBefore: Date,
    limit: number,
  ): Promise<readonly StoredLifecycleEvent[]>;
  // 未完了のイベントの送信の回数を1増やし、最後の送信日時を記録する
  markRedispatched(eventIds: readonly string[], at: Date): Promise<void>;
  // 既に物理削除の開始のイベントがある利用者には作らず、作ったイベントだけを返す
  createPurgeDueEvents(
    userIds: readonly string[],
    at: Date,
  ): Promise<readonly UserLifecycleEvent[]>;
  // 物理削除を始めていない退会済みの利用者のIDを返す
  listPurgeCandidates(
    deletedBefore: Date,
    limit: number,
  ): Promise<readonly string[]>;
  // 物理削除が終わっていない退会済みの利用者を、物理削除の開始の有無によらず数える
  countOverduePurges(deletedBefore: Date): Promise<number>;
}

export interface UserContact {
  readonly userId: string;
  readonly email: string;
  readonly nickname: string;
  readonly emailVerified: boolean;
}

export interface UserContactDirectory {
  // 退会済み・物理削除済みの利用者はundefined。停止中の利用者は返す
  findContact(userId: string): Promise<UserContact | undefined>;
}

export interface AccountExportRecord {
  readonly userId: string;
  // ZIPには書かず、決済履歴の照会に渡す
  readonly pseudonymousId: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly registeredAt: Date;
  readonly mfaEnabled: boolean;
}

export interface AccountExport {
  // 退会済み・物理削除済みの利用者はundefined。停止中の利用者は返す
  find(userId: string): Promise<AccountExportRecord | undefined>;
}

export type AdminUserStatus = 'active' | 'suspended';

export interface AdminUserRecord {
  readonly userId: string;
  readonly pseudonymousId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly status: AdminUserStatus;
  readonly suspendedAt: Date | null;
  readonly registeredAt: Date;
  readonly emailVerified: boolean;
  // 確認前と、判定サービスで判定できていない間はundetermined。列がNULLを許すため型はnullを含む
  readonly disposableEmailStatus: DisposableEmailStatus | null;
}

export interface AdminUserSearchFilter {
  // ハンドルとニックネームは大文字小文字を区別しない部分一致
  readonly handle?: string;
  readonly nickname?: string;
  // 前後の空白を除いた大文字小文字を区別しない完全一致
  readonly email?: string;
  readonly status?: AdminUserStatus;
}

export interface AdminUserDirectory {
  // 退会済みを除き、作成日時とIDの降順に並べる。limitは1〜50
  search(
    filter: AdminUserSearchFilter,
    page: { readonly after?: string; readonly limit: number },
  ): Promise<{
    readonly users: readonly AdminUserRecord[];
    readonly nextCursor: string | null;
  }>;
  // 退会済み・存在しないIDは結果に含めない
  findByIds(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdminUserRecord>>;
  // 退会していない利用者だけを、前後の空白を除いた大文字小文字を区別しない完全一致で引く
  findByEmail(email: string): Promise<AdminUserRecord | undefined>;
  // 時点より前に登録し、時点で退会していない利用者を数える
  countRegisteredAt(at: Date): Promise<number>;
}
