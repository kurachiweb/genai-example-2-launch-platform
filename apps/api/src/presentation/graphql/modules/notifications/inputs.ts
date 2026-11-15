import { z } from 'zod';

import { checkAuditReason } from '../../../../../common-lib/admin/admin-input-rules.ts';
import type { NotificationTopic } from '../../../../../common-lib/notifications/notification-topics.ts';
import type { NotificationTopic as GraphQLNotificationTopic } from '../../generated/resolvers-types.ts';
import { inputRuleOf } from '../../auth-inputs.ts';
import { INPUT_MESSAGES } from './errors.ts';

// 配信停止のトークンは86文字のbase64urlで、形式と照合はユースケースが確かめる。ここでは処理量だけを抑える
export const UNSUBSCRIBE_TOKEN_INPUT_MAX_LENGTH = 200;

const TOPICS_FROM_GRAPHQL = Object.freeze({
  MATCH_PREVIEW: 'match_preview',
  MATCH_RESULT: 'match_result',
  FOLLOWED_USER_MATCH: 'followed_user_match',
  FOLLOWED_USER_AWARD: 'followed_user_award',
} as const satisfies Record<GraphQLNotificationTopic, NotificationTopic>);

const topic = z
  .enum([
    'MATCH_PREVIEW',
    'MATCH_RESULT',
    'FOLLOWED_USER_MATCH',
    'FOLLOWED_USER_AWARD',
  ])
  .transform((value): NotificationTopic => TOPICS_FROM_GRAPHQL[value]);

export const UPDATE_NOTIFICATION_PREFERENCE_ARGS = z.object({
  input: z.object({ topic, enabled: z.boolean() }),
});

export const UNSUBSCRIBE_TOKEN_ARGS = z.object({
  token: z
    .string()
    .min(1, INPUT_MESSAGES.unsubscribeTokenInvalid)
    .max(
      UNSUBSCRIBE_TOKEN_INPUT_MAX_LENGTH,
      INPUT_MESSAGES.unsubscribeTokenInvalid,
    ),
});

const expectedVersion = z.int().min(0, INPUT_MESSAGES.expectedVersionTooSmall);

// 理由の未入力は操作種別が許すため、ここでは上限だけを確かめる
const reason = inputRuleOf((value) =>
  checkAuditReason(value) === undefined
    ? undefined
    : INPUT_MESSAGES.reasonTooLong,
)
  .nullish()
  .transform((value) => value ?? undefined);

// 送信者情報の各項目の規則はユースケースが前後の空白を除いて判定し、項目ごとの違反を返す
export const UPDATE_NOTIFICATION_SENDER_INFO_ARGS = z.object({
  input: z.object({
    businessName: z.string(),
    contactEmail: z.string(),
    postalAddress: z.string(),
    expectedVersion,
    reason,
  }),
});
