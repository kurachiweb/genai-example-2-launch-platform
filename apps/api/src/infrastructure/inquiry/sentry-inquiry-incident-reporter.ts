import {
  captureException,
  type SeverityLevel,
  withScope,
} from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  InquiryIncidentKind,
  InquiryIncidentReporter,
} from '../../application/inquiry/ports.ts';

const LEVELS: Readonly<Record<InquiryIncidentKind, SeverityLevel>> = {
  'reply-notification-failed': 'error',
  'attachment-release-failed': 'warning',
};

const MESSAGES: Readonly<Record<InquiryIncidentKind, string>> = {
  'reply-notification-failed': '返信の通知メールの送信要求に失敗しました',
  'attachment-release-failed':
    '送信に失敗したメッセージの添付ファイルを解放できませんでした',
};

const INQUIRY_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const UNSAFE_VALUE = 'unknown';

const logger = getAppLogger(['api', 'inquiry', 'incident']);

// タグは除去処理の対象外のため、識別子の形の値だけを送り、メールアドレスなどが紛れ込まないようにする
const toInquiryId = (inquiryId: string): string =>
  INQUIRY_ID_PATTERN.test(inquiryId) ? inquiryId : UNSAFE_VALUE;

@injectable()
export class SentryInquiryIncidentReporter implements InquiryIncidentReporter {
  report(
    kind: InquiryIncidentKind,
    error: unknown,
    attributes: { readonly inquiryId?: string },
  ): void {
    const level = LEVELS[kind];
    const inquiryId =
      attributes.inquiryId === undefined
        ? undefined
        : toInquiryId(attributes.inquiryId);
    const properties = {
      incident: kind,
      error,
      ...(inquiryId === undefined ? {} : { inquiryId }),
    };
    if (level === 'error') {
      logger.error(MESSAGES[kind], properties);
    } else {
      logger.warn(MESSAGES[kind], properties);
    }
    withScope((scope) => {
      scope.setLevel(level);
      scope.setTag('inquiry_incident', kind);
      if (inquiryId !== undefined) {
        scope.setTag('inquiry_id', inquiryId);
      }
      captureException(error);
    });
  }
}
