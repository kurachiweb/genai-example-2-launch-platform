import type { NoticeEmailBuild } from './notice-email.ts';
import type {
  GroupEmailPlan,
  NoticeSkipReason,
  PendingNotice,
  SkippedNotice,
} from './notice-plan.ts';

export interface NoticeGroupOutcome {
  readonly sent: readonly string[];
  readonly skipped: readonly SkippedNotice[];
}

// 開催通知の31件目以降は計画にも送らない通知にも入らず、件数だけをメールに載せるため、メールの成否に従わせる
const UNLISTED_WITHOUT_EMAIL: NoticeSkipReason = 'stale';

export function noticeGroupOutcome(input: {
  // 同じまとめのキーの通知
  readonly notices: readonly PendingNotice[];
  readonly planned: GroupEmailPlan;
  // 計画が無ければundefined
  readonly build: NoticeEmailBuild | undefined;
}): NoticeGroupOutcome {
  const { notices, planned, build } = input;
  const reasons: ReadonlyMap<string, NoticeSkipReason> = new Map(
    [...planned.skipped, ...(build?.skipped ?? [])].map(
      ({ noticeId, reason }) => [noticeId, reason],
    ),
  );
  const emailed = build?.kind === 'email';
  const reasonOf = (noticeId: string): NoticeSkipReason | undefined =>
    reasons.get(noticeId) ?? (emailed ? undefined : UNLISTED_WITHOUT_EMAIL);
  return {
    sent: notices
      .filter(({ noticeId }) => reasonOf(noticeId) === undefined)
      .map(({ noticeId }) => noticeId),
    skipped: notices.flatMap(({ noticeId }): readonly SkippedNotice[] => {
      const reason = reasonOf(noticeId);
      return reason === undefined ? [] : [{ noticeId, reason }];
    }),
  };
}
