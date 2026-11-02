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
