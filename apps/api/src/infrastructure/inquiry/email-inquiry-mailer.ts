import { inject, injectable } from 'inversify';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import { INQUIRY_REPLY_NOTIFICATION_KIND } from '../../../lib/core/email/kinds/inquiry.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import { INQUIRY_TYPES } from '../../application/inquiry/inquiry-types.ts';
import type {
  InquiryMailer,
  InquiryReplyNotification,
  InquirySettings,
} from '../../application/inquiry/ports.ts';

const INQUIRY_CHAT_PATH = '/inquiries/';

@injectable()
export class EmailInquiryMailer implements InquiryMailer {
  constructor(
    @inject(EMAIL_TYPES.EmailSender) private readonly emails: EmailSender,
    @inject(INQUIRY_TYPES.InquirySettings)
    private readonly settings: InquirySettings,
  ) {}

  async sendReplyNotification(
    notification: InquiryReplyNotification,
  ): Promise<void> {
    await this.emails.send({
      kind: INQUIRY_REPLY_NOTIFICATION_KIND,
      to: notification.to,
      input: {
        nickname: notification.nickname,
        inquiryUrl: this.chatLink(notification.inquiryId),
        repliedAt: notification.repliedAt.toISOString(),
      },
    });
  }

  private chatLink(inquiryId: string): string {
    return new URL(
      `${INQUIRY_CHAT_PATH}${encodeURIComponent(inquiryId)}`,
      this.settings.clientOrigin,
    ).href;
  }
}
