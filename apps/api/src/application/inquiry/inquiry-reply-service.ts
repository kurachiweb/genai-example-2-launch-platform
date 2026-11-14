import { inject, injectable } from 'inversify';

import { INQUIRY_REPLY_ACTION } from '../../../common-lib/admin/audit-actions/inquiry-chat.ts';
import { checkChatMessage } from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../../lib/core/identity/ports.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { checkReplyable } from '../../domain/inquiry/inquiry-status-rules.ts';
import {
  inquiryChatMessageRejectedError,
  inquiryError,
} from './inquiry-errors.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  InquiryAdminReader,
  InquiryIncidentReporter,
  InquiryMailer,
  InquiryMessageRecord,
  MemberInquiryRecord,
  MemberInquiryStore,
} from './ports.ts';

export interface InquiryReplyInput {
  readonly inquiryId: string;
  readonly body: string;
  readonly reason?: string;
}

export interface InquiryReplyResult {
  readonly message: InquiryMessageRecord;
  readonly notificationQueued: boolean;
}

export interface InquiryReplyService {
  // モデレーター以上の認可を通したリゾルバから呼ぶ。返信は添付を持たず、ステータスを変えない
  reply(
    current: CurrentAdmin,
    input: InquiryReplyInput,
  ): Promise<InquiryReplyResult>;
}

const validBodyOf = (body: string): string => {
  const issue = checkChatMessage(body);
  if (issue !== undefined) {
    throw inquiryChatMessageRejectedError(issue);
  }
  return body;
};

const reasonOf = (reason: string | undefined): { readonly reason?: string } =>
  reason === undefined ? {} : { reason };

@injectable()
export class StoreInquiryReplyService implements InquiryReplyService {
  constructor(
    @inject(INQUIRY_TYPES.InquiryAdminReader)
    private readonly reader: InquiryAdminReader,
    @inject(INQUIRY_TYPES.MemberInquiryStore)
    private readonly store: MemberInquiryStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    private readonly contacts: UserContactDirectory,
    @inject(INQUIRY_TYPES.InquiryMailer) private readonly mailer: InquiryMailer,
    @inject(INQUIRY_TYPES.InquiryIncidentReporter)
    private readonly incidents: InquiryIncidentReporter,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async reply(
    current: CurrentAdmin,
    input: InquiryReplyInput,
  ): Promise<InquiryReplyResult> {
    const body = validBodyOf(input.body);
    const inquiry = await this.#requireRepliable(input.inquiryId);
    const reply = {
      id: this.ids.generate(),
      adminId: current.id,
      body,
      at: this.clock.now(),
    };
    const audit = this.auditLog.prepare({
      operatorAdminId: current.id,
      action: INQUIRY_REPLY_ACTION.name,
      targetIds: [inquiry.id],
      ...reasonOf(input.reason),
      occurredAt: reply.at,
    });
    const result = await this.store.appendAdminReply(inquiry.id, reply, audit);
    if (result === 'not-found') {
      throw inquiryError('inquiry_not_found');
    }
    if (result === 'withdrawn') {
      throw inquiryError('inquiry_read_only');
    }
    const notificationQueued = await this.#notify(inquiry, reply.at);
    return {
      message: {
        id: reply.id,
        inquiryId: inquiry.id,
        sender: 'admin',
        adminId: current.id,
        body,
        fileIds: [],
        createdAt: reply.at,
      },
      notificationQueued,
    };
  }

  async #requireRepliable(inquiryId: string): Promise<MemberInquiryRecord> {
    const detail = await this.reader.findDetail(inquiryId);
    if (detail === undefined) {
      throw inquiryError('inquiry_not_found');
    }
    const denial = checkReplyable({
      kind: detail.kind,
      withdrawn: detail.kind === 'member' && detail.inquiry.deletedAt !== null,
    });
    if (denial === 'guest-not-repliable' || detail.kind === 'guest') {
      throw inquiryError('inquiry_not_repliable');
    }
    if (denial === 'withdrawn') {
      throw inquiryError('inquiry_read_only');
    }
    return detail.inquiry;
  }

  // 返信は保存済みのため、通知の失敗で例外を返すと管理者の再送で返信が二重になる。失敗は通知の可否と報告で伝える
  async #notify(
    inquiry: MemberInquiryRecord,
    repliedAt: Date,
  ): Promise<boolean> {
    try {
      // 返信の通知はトランザクションメールのため、メールアドレスが未確認・停止中の利用者にも送る
      const contact = await this.contacts.findContact(inquiry.userId);
      if (contact === undefined) {
        return false;
      }
      await this.mailer.sendReplyNotification({
        to: contact.email,
        nickname: contact.nickname,
        inquiryId: inquiry.id,
        repliedAt,
      });
      return true;
    } catch (error: unknown) {
      this.incidents.report('reply-notification-failed', error, {
        inquiryId: inquiry.id,
      });
      return false;
    }
  }
}
