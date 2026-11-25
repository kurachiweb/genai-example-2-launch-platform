import { z } from 'zod';

import {
  MODERATION_REASON_MAX,
  NOTICE_EXCERPT_MAX,
} from '../../../../common-lib/moderation/moderation-actions.ts';
import { countGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../common-lib/text/white-space.ts';
import { type AnyEmailKind, defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema as linkUrl } from './link-url.ts';

const text = z.string().min(1);

const utcDateTime = z.iso.datetime();

// 管理画面の理由の上限は書記素で数えるため、絵文字を含む理由も同じ数え方で受け付ける
const reason = text
  .refine((value) => trimWhiteSpace(value) !== '', {
    message: '理由を指定してください',
  })
  .refine((value) => countGraphemes(value) <= MODERATION_REASON_MAX, {
    message: `理由は${String(MODERATION_REASON_MAX)}文字以内で指定してください`,
  });

const excerpt = text.refine(
  (value) => countGraphemes(value) <= NOTICE_EXCERPT_MAX,
  {
    message: `抜粋は${String(NOTICE_EXCERPT_MAX)}文字以内で指定してください`,
  },
);

const userSuspendedInput = z.object({
  nickname: text,
  reason,
  suspendedAt: utcDateTime,
  contactUrl: linkUrl,
});

const productHiddenInput = z.object({
  nickname: text,
  productName: text,
  reason,
  hiddenAt: utcDateTime,
  contactUrl: linkUrl,
});

const commentHiddenInput = z.object({
  nickname: text,
  productName: text,
  excerpt,
  reason,
  hiddenAt: utcDateTime,
  contactUrl: linkUrl,
});

export type ModerationUserSuspendedInput = z.infer<typeof userSuspendedInput>;

export type ModerationProductHiddenInput = z.infer<typeof productHiddenInput>;

export type ModerationCommentHiddenInput = z.infer<typeof commentHiddenInput>;

export const MODERATION_USER_SUSPENDED_EMAIL = defineEmailKind({
  name: 'ugc-moderation.user-suspended',
  category: 'transactional',
  inputSchema: userSuspendedInput,
});

export const MODERATION_PRODUCT_HIDDEN_EMAIL = defineEmailKind({
  name: 'ugc-moderation.product-hidden',
  category: 'transactional',
  inputSchema: productHiddenInput,
});

export const MODERATION_COMMENT_HIDDEN_EMAIL = defineEmailKind({
  name: 'ugc-moderation.comment-hidden',
  category: 'transactional',
  inputSchema: commentHiddenInput,
});

export const MODERATION_EMAIL_KINDS: readonly AnyEmailKind[] = Object.freeze([
  MODERATION_USER_SUSPENDED_EMAIL,
  MODERATION_PRODUCT_HIDDEN_EMAIL,
  MODERATION_COMMENT_HIDDEN_EMAIL,
]);
