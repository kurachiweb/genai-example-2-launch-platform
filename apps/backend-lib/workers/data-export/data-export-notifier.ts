import type { Logger } from '@logtape/logtape';

import type { DataExportFailureKind } from '../../../common-lib/data-export/data-export-rules.ts';
import type {
  DataExportNotifier,
  DataExportRecord,
  DataExportStore,
} from '../../core/data-export/ports.ts';
import {
  DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
  DATA_EXPORT_ARCHIVE_READY_EMAIL,
} from '../../core/email/kinds/data-export.ts';
import type { EmailSender } from '../../core/email/ports.ts';
import type {
  UserContact,
  UserContactDirectory,
} from '../../core/identity/ports.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

type NotifyOutcome = Awaited<ReturnType<DataExportNotifier['notify']>>;

export type DataExportNotifierEnv = PlatformEnv & {
  readonly CLIENT_SITE_ORIGIN: string;
};

type NoticePlan =
  | { readonly kind: 'ready'; readonly expiresAt: Date }
  | { readonly kind: 'failed'; readonly failureKind: DataExportFailureKind }
  | { readonly kind: 'skip'; readonly reason: string };

const PAGE_PATH = '/settings/export';

const CONTACT_PATH = '/contact';

// 期限切れの記録は完了のメールのリンクの先が無く、状態と列が合わない記録は送り直しても直らないため、どちらも送らない対象にする
function planOf(record: DataExportRecord): NoticePlan {
  if (record.status === 'ready' && record.expiresAt !== null) {
    return { kind: 'ready', expiresAt: record.expiresAt };
  }
  if (record.status === 'failed' && record.failureKind !== null) {
    return { kind: 'failed', failureKind: record.failureKind };
  }
  return { kind: 'skip', reason: `status_${record.status}` };
}

export class EmailDataExportNotifier implements DataExportNotifier {
  private readonly pageUrl: string;
  private readonly contactUrl: string;
  private readonly logger: Logger;

  constructor(
    private readonly store: DataExportStore,
    private readonly contacts: UserContactDirectory,
    private readonly emails: EmailSender,
    env: DataExportNotifierEnv,
    appName: LoggingOptions['appName'],
  ) {
    this.pageUrl = new URL(PAGE_PATH, env.CLIENT_SITE_ORIGIN).href;
    this.contactUrl = new URL(CONTACT_PATH, env.CLIENT_SITE_ORIGIN).href;
    this.logger = getAppLogger([appName, 'infrastructure', 'data-export']);
  }

  async notify(exportId: string): Promise<NotifyOutcome> {
    const record = await this.store.find(exportId);
    if (record?.noticeStatus !== 'pending') {
      return 'not_pending';
    }
    const plan = planOf(record);
    if (plan.kind === 'skip') {
      this.logger.info('通知の対象外のため、メールを送らずに終えました', {
        exportId,
        reason: plan.reason,
      });
      return this.advance(exportId, 'skipped');
    }
    const contact = await this.contacts.findContact(record.userId);
    if (contact === undefined) {
      this.logger.info('宛先の利用者がいないため、メールを送らずに終えました', {
        exportId,
        reason: 'recipient_gone',
      });
      return this.advance(exportId, 'skipped');
    }
    await this.send(record, plan, contact);
    return this.advance(exportId, 'requested');
  }

  private async advance(
    exportId: string,
    to: 'requested' | 'skipped',
  ): Promise<NotifyOutcome> {
    const advanced = await this.store.advanceNotice({ id: exportId, to });
    return advanced ? to : 'not_pending';
  }

  // 冪等のキーは要求のIDだけでよい。完了と失敗は別の種別で、1つの要求はどちらか一方だけが確定する
  private async send(
    record: DataExportRecord,
    plan: Exclude<NoticePlan, { readonly kind: 'skip' }>,
    contact: UserContact,
  ): Promise<void> {
    const common = {
      nickname: contact.nickname,
      requestedAt: record.requestedAt.toISOString(),
      pageUrl: this.pageUrl,
    };
    if (plan.kind === 'ready') {
      await this.emails.send({
        kind: DATA_EXPORT_ARCHIVE_READY_EMAIL,
        to: contact.email,
        input: { ...common, expiresAt: plan.expiresAt.toISOString() },
        idempotencyKey: record.id,
      });
      return;
    }
    await this.emails.send({
      kind: DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
      to: contact.email,
      input: {
        ...common,
        reason: plan.failureKind,
        contactUrl: this.contactUrl,
      },
      idempotencyKey: record.id,
    });
  }
}
