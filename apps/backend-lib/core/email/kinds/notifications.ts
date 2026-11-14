import { z } from 'zod';

import type { ResultOutcome } from '../../notifications/notice-copy.ts';
import { DIGEST_ITEM_LIMIT } from '../../notifications/notice-plan.ts';
import { AWARD_KINDS } from '../../notifications/notification-event-contract.ts';
import { resultNoticeSupplementSchema } from '../../notifications/result-notice-supplements.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

export const MATCH_RESULT_SUPPLEMENT_LIMIT = 3;

const RESULT_OUTCOMES = Object.freeze([
  'won',
  'lost',
  'no_votes',
  'bye',
] as const satisfies readonly ResultOutcome[]);

const COMBINABLE_OUTCOMES: ReadonlySet<string> = new Set<ResultOutcome>([
  'won',
  'bye',
]);

const text = z.string().min(1);

const utcDateTime = z.iso.datetime();

const count = z.number().int().nonnegative();

const noticeLinks = {
  settingsUrl: linkUrl,
  unsubscribeUrl: linkUrl,
};

const matchPreviewInput = z.object({
  ...noticeLinks,
  nickname: text,
  ownProductName: text,
  opponentProductName: text,
  matchLabel: text,
  startsAt: utcDateTime,
  endsAt: utcDateTime,
  topPageUrl: linkUrl,
});

const nextMatchInput = z.object({
  opponentProductName: text,
  roundName: text,
  matchLabel: text,
  startsAt: utcDateTime,
  endsAt: utcDateTime,
  unsubscribeUrl: linkUrl,
});

// 件名の「次は<ラウンド名>」は勝利と不戦勝にだけあるため、他の結果に翌日の予告を添えた入力は受け付けない
const matchResultInput = z
  .object({
    ...noticeLinks,
    nickname: text,
    ownProductName: text,
    opponentProductName: text,
    matchLabel: text,
    outcome: z.enum(RESULT_OUTCOMES),
    decidedByLastUpvote: z.boolean(),
    ownVotes: count,
    opponentVotes: count,
    supplements: z
      .array(resultNoticeSupplementSchema)
      .max(MATCH_RESULT_SUPPLEMENT_LIMIT),
    action: z.object({ label: text, url: linkUrl }),
    next: nextMatchInput.nullable(),
  })
  .refine(
    (input) => input.next === null || COMBINABLE_OUTCOMES.has(input.outcome),
    {
      message: '翌日の予告と統合できるのは勝利と不戦勝の結果だけです',
      path: ['next'],
    },
  );

const followedUserMatchesInput = z.object({
  ...noticeLinks,
  nickname: text,
  items: z
    .array(
      z.object({
        productName: text,
        makerNickname: text,
        matchLabel: text,
        opponentProductName: text,
      }),
    )
    .min(1)
    .max(DIGEST_ITEM_LIMIT),
  omittedCount: count,
  topPageUrl: linkUrl,
});

const followedUserAwardInput = z.object({
  ...noticeLinks,
  nickname: text,
  productName: text,
  makerNickname: text,
  award: z.enum(AWARD_KINDS),
  periodLabel: text,
  productUrl: linkUrl,
});

export type MatchPreviewEmailInput = z.infer<typeof matchPreviewInput>;

export type MatchResultEmailInput = z.infer<typeof matchResultInput>;

export type FollowedUserMatchesEmailInput = z.infer<
  typeof followedUserMatchesInput
>;

export type FollowedUserAwardEmailInput = z.infer<
  typeof followedUserAwardInput
>;

export const NOTIFICATION_MATCH_PREVIEW_KIND = defineEmailKind({
  name: 'notifications.match-preview',
  category: 'notification',
  inputSchema: matchPreviewInput,
});

export const NOTIFICATION_MATCH_RESULT_KIND = defineEmailKind({
  name: 'notifications.match-result',
  category: 'notification',
  inputSchema: matchResultInput,
});

export const NOTIFICATION_FOLLOWED_USER_MATCHES_KIND = defineEmailKind({
  name: 'notifications.followed-user-matches',
  category: 'notification',
  inputSchema: followedUserMatchesInput,
});

export const NOTIFICATION_FOLLOWED_USER_AWARD_KIND = defineEmailKind({
  name: 'notifications.followed-user-award',
  category: 'notification',
  inputSchema: followedUserAwardInput,
});

export const NOTIFICATION_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  NOTIFICATION_MATCH_PREVIEW_KIND,
  NOTIFICATION_MATCH_RESULT_KIND,
  NOTIFICATION_FOLLOWED_USER_MATCHES_KIND,
  NOTIFICATION_FOLLOWED_USER_AWARD_KIND,
]);
