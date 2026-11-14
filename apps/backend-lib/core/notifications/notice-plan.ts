import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import type { MatchPhase } from '../match/match-model.ts';
import type { BusinessDate } from '../time/business-time.ts';
import {
  type NotificationSlot,
  previewSlotFor,
  resultSlotFor,
} from './notification-slots.ts';

export interface NoticeDraft {
  readonly topic: NotificationTopic;
  readonly recipientUserId: string;
  readonly slot: NotificationSlot;
  readonly matchId: string | null;
  readonly entryId: string | null;
  readonly productId: string | null;
  readonly eventId: string | null;
}

export interface MatchNoticeEntry {
  readonly entryId: string;
  readonly productId: string | null;
  readonly ownerUserId: string | null;
}

export interface MatchNoticeSource {
  readonly matchId: string;
  readonly matchDate: BusinessDate;
  readonly phase: MatchPhase;
  readonly decided: boolean;
  readonly entries: readonly MatchNoticeEntry[];
}

export type MatchNoticeTopic = 'match_preview' | 'match_result';

export type NoticeSkipReason =
  | 'topic_disabled'
  | 'recipient_unavailable'
  | 'email_not_verified'
  | 'suppressed'
  | 'sender_info_missing'
  | 'own_product_unavailable'
  | 'stale'
  | 'recipient_withdrawn'
  | 'send_rejected'
  | 'expired';

export interface PendingNotice extends NoticeDraft {
  readonly noticeId: string;
}

export interface SkippedNotice {
  readonly noticeId: string;
  readonly reason: NoticeSkipReason;
}

export const DIGEST_ITEM_LIMIT = 30;

export type NoticeEmailPlan =
  | {
      readonly kind: 'match-preview';
      readonly recipientUserId: string;
      readonly preview: PendingNotice;
    }
  | {
      readonly kind: 'match-result';
      readonly recipientUserId: string;
      readonly result: PendingNotice;
      readonly preview: PendingNotice | null;
    }
  | {
      readonly kind: 'followed-user-matches';
      readonly recipientUserId: string;
      readonly items: readonly PendingNotice[];
      readonly omittedCount: number;
    }
  | {
      readonly kind: 'followed-user-award';
      readonly recipientUserId: string;
      readonly award: PendingNotice;
    };

export interface GroupEmailPlan {
  readonly plan: NoticeEmailPlan | null;
  readonly skipped: readonly SkippedNotice[];
}

const MATCH_SIDE_COUNT = 2;

export function noticeDedupeKey(draft: NoticeDraft): string {
  const sourceId = draft.matchId ?? draft.eventId;
  const subjectId = draft.entryId ?? draft.productId;
  if (sourceId === null || subjectId === null) {
    throw new RangeError(
      '通知の下書きにはマッチか通知イベントのIDと、側かプロダクトのIDが必要です',
    );
  }
  return `${draft.topic}:${sourceId}:${subjectId}:${draft.recipientUserId}`;
}

export function groupKeyFor(draft: NoticeDraft): string {
  const base = `${draft.slot.key}:${draft.recipientUserId}`;
  if (draft.slot.kind !== 'evening') {
    return base;
  }
  if (draft.productId === null) {
    throw new RangeError('夜の枠の通知の下書きにはプロダクトのIDが必要です');
  }
  return `${base}:${draft.productId}`;
}

function isNoticeTarget(
  topic: MatchNoticeTopic,
  match: MatchNoticeSource,
): boolean {
  if (topic === 'match_result') {
    return match.decided;
  }
  return (
    match.phase === 'scheduled' && match.entries.length === MATCH_SIDE_COUNT
  );
}

export function matchNoticeDrafts(input: {
  readonly topic: MatchNoticeTopic;
  readonly matches: readonly MatchNoticeSource[];
  readonly eligible: ReadonlySet<string>;
}): readonly NoticeDraft[] {
  const { topic, eligible } = input;
  return input.matches
    .filter((match) => isNoticeTarget(topic, match))
    .flatMap((match) => {
      const slot =
        topic === 'match_preview'
          ? previewSlotFor(match.matchDate)
          : resultSlotFor(match.matchDate);
      return match.entries.flatMap(({ entryId, productId, ownerUserId }) =>
        productId === null || ownerUserId === null || !eligible.has(ownerUserId)
          ? []
          : [
              {
                topic,
                recipientUserId: ownerUserId,
                slot,
                matchId: match.matchId,
                entryId,
                productId,
                eventId: null,
              },
            ],
      );
    });
}

function skipAll(
  notices: readonly PendingNotice[],
  reason: NoticeSkipReason,
): readonly SkippedNotice[] {
  return notices.map(({ noticeId }) => ({ noticeId, reason }));
}

function ofTopic(
  notices: readonly PendingNotice[],
  topic: NotificationTopic,
): readonly PendingNotice[] {
  return notices.filter((notice) => notice.topic === topic);
}

function selectPlan(
  recipientUserId: string,
  notices: readonly PendingNotice[],
): NoticeEmailPlan | null {
  const [result] = ofTopic(notices, 'match_result');
  const [preview] = ofTopic(notices, 'match_preview');
  if (result !== undefined) {
    return {
      kind: 'match-result',
      recipientUserId,
      result,
      preview: preview ?? null,
    };
  }
  if (preview !== undefined) {
    return { kind: 'match-preview', recipientUserId, preview };
  }
  const followedMatches = ofTopic(notices, 'followed_user_match');
  if (followedMatches.length > 0) {
    return {
      kind: 'followed-user-matches',
      recipientUserId,
      items: followedMatches.slice(0, DIGEST_ITEM_LIMIT),
      omittedCount: Math.max(0, followedMatches.length - DIGEST_ITEM_LIMIT),
    };
  }
  const [award] = ofTopic(notices, 'followed_user_award');
  return award === undefined
    ? null
    : { kind: 'followed-user-award', recipientUserId, award };
}

function plannedNotices(
  plan: NoticeEmailPlan | null,
): readonly PendingNotice[] {
  switch (plan?.kind) {
    case undefined:
      return [];
    case 'match-preview':
      return [plan.preview];
    case 'match-result':
      return plan.preview === null
        ? [plan.result]
        : [plan.result, plan.preview];
    case 'followed-user-matches':
      return plan.items;
    case 'followed-user-award':
      return [plan.award];
  }
}

export function planGroupEmail(input: {
  readonly notices: readonly PendingNotice[];
  readonly enabledTopics: ReadonlySet<NotificationTopic> | undefined;
}): GroupEmailPlan {
  const { notices, enabledTopics } = input;
  const [first] = notices;
  if (first === undefined) {
    return { plan: null, skipped: [] };
  }
  if (enabledTopics === undefined) {
    return { plan: null, skipped: skipAll(notices, 'recipient_unavailable') };
  }
  const enabled = notices.filter((notice) => enabledTopics.has(notice.topic));
  const plan = selectPlan(first.recipientUserId, enabled);
  const planned = new Set(plannedNotices(plan));
  // 開催通知の31件目以降は件数だけを載せて送った扱いにするため、送らない通知に含めない
  const isOmittedDigestItem = (notice: PendingNotice): boolean =>
    plan?.kind === 'followed-user-matches' &&
    notice.topic === 'followed_user_match';
  const skipped = notices.flatMap((notice): readonly SkippedNotice[] => {
    if (!enabledTopics.has(notice.topic)) {
      return [{ noticeId: notice.noticeId, reason: 'topic_disabled' }];
    }
    if (planned.has(notice) || isOmittedDigestItem(notice)) {
      return [];
    }
    return [{ noticeId: notice.noticeId, reason: 'stale' }];
  });
  return { plan, skipped };
}
