import type {
  ModerationAction,
  NoticeStatus,
} from '../../../common-lib/moderation/moderation-actions.ts';

export interface NewModerationRecord {
  readonly id: string;
  readonly action: ModerationAction;
  readonly targetId: string;
  readonly subjectUserId: string | null;
  readonly productId: string | null;
  readonly operatorAdminId: string;
  readonly reason: string | null;
  readonly lifecycleEventId: string | null;
  readonly occurredAt: Date;
  readonly noticeStatus: NoticeStatus;
}

export interface ModerationRecord extends NewModerationRecord {
  readonly noticeRequestedAt: Date | null;
}

export interface LatestModeration {
  readonly action: ModerationAction;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

export interface ModerationRecordStore {
  find(id: string): Promise<ModerationRecord | undefined>;
  latestFor(input: {
    readonly targetIds: readonly string[];
    readonly actions: readonly ModerationAction[];
  }): Promise<ReadonlyMap<string, LatestModeration>>;
  listPendingNotices(input: {
    readonly occurredBefore: Date;
    readonly limit: number;
  }): Promise<readonly ModerationRecord[]>;
  markNotice(input: {
    readonly id: string;
    readonly from: 'pending';
    readonly to: 'requested' | 'skipped';
    readonly at: Date;
  }): Promise<boolean>;
  eraseBySubjectUser(
    userId: string,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  eraseByProduct(
    productId: string,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  eraseOccurredBefore(threshold: Date, limit: number): Promise<number>;
}
