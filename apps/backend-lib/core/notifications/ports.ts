import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import type { SenderInfo } from '../email/ports.ts';
import type {
  NoticeDraft,
  NoticeSkipReason,
  PendingNotice,
} from './notice-plan.ts';
import type { NotificationEvent } from './notification-event-contract.ts';
import type { NotificationSlot } from './notification-slots.ts';

export interface NotificationPreferenceStore {
  // 4種別すべてを返し、行が無い種別はfalse
  preferencesOf(
    userId: string,
  ): Promise<ReadonlyMap<NotificationTopic, boolean>>;
  setPreference(input: {
    readonly userId: string;
    readonly topic: NotificationTopic;
    readonly enabled: boolean;
    readonly at: Date;
  }): Promise<void>;
  // 受信する設定で、メールアドレスを確認済みの停止中でない利用者だけを返す
  eligibleRecipients(
    userIds: readonly string[],
    topic: NotificationTopic,
  ): Promise<ReadonlySet<string>>;
  // 送信の対象者の利用者だけをキーに持つ
  enabledTopicsOf(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReadonlySet<NotificationTopic>>>;
  deleteAllOf(userId: string): Promise<void>;
}

export interface NotificationWorkRequester {
  // 遅延は0〜43200秒
  flushSlot(slotKey: string, delaySeconds: number): Promise<void>;
  expandEvent(eventId: string): Promise<void>;
}

export interface UnsubscribeTarget {
  readonly userId: string;
  readonly topic: NotificationTopic;
}

export interface UnsubscribeTokenService {
  // キーは'<userId>:<topic>'。種が無ければ作る
  tokensFor(
    targets: readonly UnsubscribeTarget[],
    at: Date,
  ): Promise<ReadonlyMap<string, string>>;
  // 形式違反・不一致・退会で種が消えたトークンはundefined
  resolve(token: string): Promise<UnsubscribeTarget | undefined>;
  deleteAllOf(userId: string): Promise<void>;
}

export interface SenderInfoRecord {
  // シードの固定のID
  readonly settingId: string;
  // 0は未設定
  readonly version: number;
  readonly info: SenderInfo | undefined;
  readonly updatedAt: Date;
  readonly updatedByAdminId: string | null;
}

export interface SenderInfoStore {
  // シードの行が無いときだけundefined
  get(): Promise<SenderInfoRecord | undefined>;
}

export type SlotPhase = 'waiting' | 'collecting' | 'sending' | 'done';

export interface StoredSlot extends NotificationSlot {
  readonly phase: SlotPhase;
  // 収集の段の進み具合(JSON)
  readonly cursor: string | null;
  // 夜の枠の送り出しの前提を確定させた時点の写し。未確定はnull
  readonly requiredParticipants: readonly string[] | null;
  readonly dispatchRequestedAt: Date | null;
}

export interface SlotProgress {
  readonly phase: SlotPhase;
  readonly cursor: string | null;
}

export interface NotificationSlotStore {
  ensure(slot: NotificationSlot, at: Date): Promise<StoredSlot>;
  find(key: string): Promise<StoredSlot | undefined>;
  // リースの期限が過ぎているか、保持者が同じ場合だけ取れる
  acquireLease(
    key: string,
    holder: string,
    now: Date,
    seconds: number,
  ): Promise<boolean>;
  releaseLease(key: string, holder: string): Promise<void>;
  // リースの保持者だけが更新できる
  advance(
    key: string,
    holder: string,
    change: SlotProgress,
    at: Date,
  ): Promise<void>;
  // doneでなく、送り出しの期限がbeforeより前の枠
  listOverdue(before: Date, limit: number): Promise<readonly StoredSlot[]>;
  // 前提のうち準備の完了が無い名前。前提の一覧が未確定ならnull
  missingParticipants(key: string): Promise<readonly string[] | null>;
  // 既に記録があれば変えない
  markDispatchRequested(key: string, at: Date): Promise<void>;
  // 前提の一覧が未確定のときだけ書き込み、書き込んだらtrue
  fixParticipants(
    key: string,
    participants: readonly string[],
    at: Date,
  ): Promise<boolean>;
  // doneで、作成がbeforeより前の未送信の通知が残る枠
  listDoneWithPending(
    before: Date,
    limit: number,
  ): Promise<readonly StoredSlot[]>;
}

export interface NoticeGroup {
  readonly groupKey: string;
  readonly notices: readonly PendingNotice[];
}

export interface NoticeRecordResult {
  readonly created: number;
  // 記録した枠のうち、送り出し中か完了したもの
  readonly lateSlotKeys: readonly string[];
}

export interface NoticeSettlement {
  readonly noticeId: string;
  readonly status: 'sent' | 'skipped';
  readonly reason: NoticeSkipReason | null;
  readonly emailRequestId: string | null;
}

export interface NotificationNoticeStore {
  record(drafts: readonly NoticeDraft[], at: Date): Promise<NoticeRecordResult>;
  // まとめのキーの昇順
  nextPendingGroups(
    slotKey: string,
    limit: number,
  ): Promise<readonly NoticeGroup[]>;
  // 未送信の行だけを更新する
  settle(entries: readonly NoticeSettlement[], at: Date): Promise<void>;
  deleteByRecipient(userId: string, limit: number): Promise<number>;
}

export interface StoredNotificationEvent {
  readonly eventId: string;
  readonly event: NotificationEvent;
  readonly status: 'pending' | 'expanded';
  // 受賞のフォロワーの進み具合
  readonly cursor: string | null;
  readonly occurredAt: Date;
}

export type NotificationEventExpansion =
  | {
      readonly kind: 'done';
      readonly lateSlotKeys: readonly string[];
      readonly flushSlotKey: string | null;
    }
  | { readonly kind: 'continue' };

export interface NotificationEventExpander {
  expand(
    eventId: string,
    now: Date,
    budget: number,
  ): Promise<NotificationEventExpansion>;
}

export interface NotificationSettingsExportRecord {
  readonly matchPreview: boolean;
  readonly matchResult: boolean;
  readonly followedUserMatch: boolean;
  readonly followedUserAward: boolean;
  readonly suppressedReason: 'bounce' | 'complaint' | 'rejected' | null;
}

export interface NotificationSettingsExport {
  // 退会済み・物理削除済みの利用者はundefined
  find(userId: string): Promise<NotificationSettingsExportRecord | undefined>;
}

export type NotificationIncident =
  | { readonly kind: 'slot-overdue'; readonly slotKey: string }
  | {
      readonly kind: 'evening-dispatch-incomplete';
      readonly slotKey: string;
      // nullはその夜に前提の一覧が確定しなかったこと
      readonly missing: readonly string[] | null;
    }
  | { readonly kind: 'sender-info-missing'; readonly skipped: number }
  | {
      readonly kind: 'send-rejected';
      readonly emailKind: string;
      readonly reason: string;
    }
  | { readonly kind: 'event-stalled'; readonly eventId: string };

export interface NotificationIncidentReporter {
  report(incident: NotificationIncident): void;
}
