import { inject, injectable } from 'inversify';

import { toMatchingKey } from '../../../lib/core/email/email-address.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type { SuppressionList } from '../../../lib/core/email/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { suppressionReasonOf } from '../../../lib/core/notifications/notice-copy.ts';
import type {
  DeliveryStatus,
  DeliveryStatusReader,
} from '../../application/notifications/ports.ts';

const logger = getAppLogger(['api', 'infrastructure', 'notifications']);

@injectable()
export class SuppressionDeliveryStatusReader implements DeliveryStatusReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    private readonly contacts: UserContactDirectory,
    @inject(EMAIL_TYPES.SuppressionList)
    private readonly suppressions: SuppressionList,
  ) {}

  // 停止中の利用者にも除外の理由を示すため状態は見ない
  async statusOf(userId: string): Promise<DeliveryStatus> {
    try {
      const contact = await this.contacts.findContact(userId);
      if (contact === undefined) {
        return { kind: 'unknown' };
      }
      const status = await this.suppressions.getStatus(
        toMatchingKey(contact.email),
      );
      return status.suppressed
        ? {
            kind: 'suppressed',
            reason: suppressionReasonOf(status.lastReason),
            until: status.expiresAt,
          }
        : { kind: 'deliverable' };
    } catch {
      // 照会の例外はSQLのバインド値としてメールアドレスを含み得るため、利用者のIDだけを残す
      logger.warn('配信の状態の照会に失敗しました', { userId });
      return { kind: 'unknown' };
    }
  }
}
