import { MODERATION_COMMENT_HIDDEN_EMAIL } from '../../../../../lib/core/email/kinds/ugc-moderation.ts';
import { defineEmailTemplate } from '../../rendering/email-template.ts';
import { CommentHiddenEmailBody } from './comment-hidden-email-body.tsx';
import {
  CONTACT_ACTION_LABEL,
  commentHiddenLead,
} from './moderation-notice-copy.ts';

export const MODERATION_COMMENT_HIDDEN_TEMPLATE = defineEmailTemplate({
  kind: MODERATION_COMMENT_HIDDEN_EMAIL,
  subject: () => 'コメントの公開が停止されました',
  preview: (input) => commentHiddenLead(input.productName),
  greeting: (input) => input.nickname,
  action: (input) => ({ label: CONTACT_ACTION_LABEL, url: input.contactUrl }),
  Body: CommentHiddenEmailBody,
});
