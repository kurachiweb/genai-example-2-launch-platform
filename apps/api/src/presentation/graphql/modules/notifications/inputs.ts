import { z } from 'zod';

import type { NotificationTopic } from '../../../../../common-lib/notifications/notification-topics.ts';
import type { NotificationTopic as GraphQLNotificationTopic } from '../../generated/resolvers-types.ts';
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
