import { describe, expect, test } from 'bun:test';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import { buildNoticeEmail } from './notice-email.ts';
import {
  context,
  followedNotice,
  notice,
  RESULT_NOTICE,
  withoutProduct,
} from './notice-email.fixtures.ts';
import { type GroupEmailPlan, planGroupEmail } from './notice-plan.ts';
import { noticeGroupOutcome } from './notice-settlement.ts';

const ALL_TOPICS: ReadonlySet<NotificationTopic> = new Set([
  'match_preview',
  'match_result',
  'followed_user_match',
  'followed_user_award',
]);

const DIGEST = Array.from({ length: 32 }, (_value, index) =>
  followedNotice(
    `notice-${String(index + 1).padStart(2, '0')}`,
    'match-live',
    'b',
  ),
);

function plannedOf(planned: GroupEmailPlan) {
  if (planned.plan === null) {
    throw new Error('計画がありません');
  }
  return planned.plan;
}

describe('noticeGroupOutcome', () => {
  test('メールを組み立てた場合は、31件目以降を含めて送らない通知以外を送った扱いにする', () => {
    const planned = planGroupEmail({
      notices: DIGEST,
      enabledTopics: ALL_TOPICS,
    });
    const build = buildNoticeEmail(plannedOf(planned), context());

    const outcome = noticeGroupOutcome({ notices: DIGEST, planned, build });

    expect(build.kind).toBe('email');
    expect(outcome.sent).toEqual(DIGEST.map(({ noticeId }) => noticeId));
    expect(outcome.skipped).toEqual([]);
  });

  test('計画と組み立ての送らない通知はその理由で、通知の順に1回ずつ返す', () => {
    const disabled = notice('notice-disabled', { topic: 'match_preview' });
    const notices = [RESULT_NOTICE, disabled];
    const planned = planGroupEmail({
      notices,
      enabledTopics: new Set<NotificationTopic>(['match_result']),
    });
    const build = buildNoticeEmail(
      plannedOf(planned),
      withoutProduct('product-a'),
    );

    expect(noticeGroupOutcome({ notices, planned, build })).toEqual({
      sent: [],
      skipped: [
        { noticeId: 'notice-result', reason: 'own_product_unavailable' },
        { noticeId: 'notice-disabled', reason: 'topic_disabled' },
      ],
    });
  });

  test('開催通知を送らない場合は、31件目以降も古い通知として送らない扱いにする', () => {
    const planned = planGroupEmail({
      notices: DIGEST,
      enabledTopics: ALL_TOPICS,
    });
    const build = buildNoticeEmail(
      plannedOf(planned),
      withoutProduct('product-b'),
    );

    const outcome = noticeGroupOutcome({ notices: DIGEST, planned, build });

    expect(outcome.sent).toEqual([]);
    expect(outcome.skipped).toHaveLength(32);
    expect(
      outcome.skipped
        .slice(0, 30)
        .every(({ reason }) => reason === 'own_product_unavailable'),
    ).toBe(true);
    expect(outcome.skipped.slice(30)).toEqual([
      { noticeId: 'notice-31', reason: 'stale' },
      { noticeId: 'notice-32', reason: 'stale' },
    ]);
  });

  test('計画が無い場合は計画の送らない通知だけを返す', () => {
    const notices = [RESULT_NOTICE];
    const planned = planGroupEmail({ notices, enabledTopics: undefined });

    expect(noticeGroupOutcome({ notices, planned, build: undefined })).toEqual({
      sent: [],
      skipped: [{ noticeId: 'notice-result', reason: 'recipient_unavailable' }],
    });
  });
});
