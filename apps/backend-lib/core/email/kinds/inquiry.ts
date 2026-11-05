import { z } from 'zod';

import { defineEmailKind } from '../email-kind.ts';
import { linkUrlSchema } from './link-url.ts';

const replyNotificationInput = z.object({
  nickname: z.string().min(1),
  inquiryUrl: linkUrlSchema,
  repliedAt: z.iso.datetime(),
});

export type InquiryReplyNotificationInput = z.infer<
  typeof replyNotificationInput
>;

export const INQUIRY_REPLY_NOTIFICATION_KIND = defineEmailKind({
  name: 'inquiry.reply-notification',
  category: 'transactional',
  inputSchema: replyNotificationInput,
});
