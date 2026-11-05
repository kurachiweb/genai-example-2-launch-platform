import { inject, injectable } from 'inversify';

import type { InquiryStatus } from '../../../common-lib/inquiry/inquiry-status.ts';
import { checkChatMessage } from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AccountGuard,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import { statusAfterUserMessage } from '../../domain/inquiry/inquiry-status-rules.ts';
import type { InquiryAttachmentBinder } from './inquiry-attachment-binder.ts';
import {
  inquiryChatMessageRejectedError,
  inquiryError,
} from './inquiry-errors.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  InquiryMessageRecord,
  MemberInquiryPage,
  MemberInquiryRecord,
  MemberInquiryStore,
  NewInquiryMessage,
} from './ports.ts';

const MY_INQUIRY_PAGE_SIZE = 20;

export interface MemberInquiryView {
  readonly inquiry: MemberInquiryRecord;
  readonly messages: readonly InquiryMessageRecord[];
  readonly canPost: boolean;
}

export interface InquiryMessageInput {
  readonly body: string;
  readonly fileIds: readonly string[];
}

export interface InquiryChatService {
  // 本人以外・不在・論理削除の問い合わせは区別せずにundefinedを返す
  view(
    session: SessionView,
    inquiryId: string,
  ): Promise<MemberInquiryView | undefined>;
  post(
    session: SessionView,
    inquiryId: string,
    input: InquiryMessageInput,
    now: Date,
  ): Promise<InquiryMessageRecord>;
  listMine(
    session: SessionView,
    after: string | undefined,
  ): Promise<MemberInquiryPage>;
}

const isVisibleTo = (
  inquiry: MemberInquiryRecord | undefined,
  user: UserAccountView,
): inquiry is MemberInquiryRecord =>
  inquiry !== undefined &&
  inquiry.userId === user.id &&
  inquiry.deletedAt === null;

const validBodyOf = (body: string): string => {
  const issue = checkChatMessage(body);
  if (issue !== undefined) {
    throw inquiryChatMessageRejectedError(issue);
  }
  return body;
};

// 利用者の送信によるステータスの戻しは管理操作ではないため、監査ログに記録しない
@injectable()
export class StoreInquiryChatService implements InquiryChatService {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(INQUIRY_TYPES.MemberInquiryStore)
    private readonly store: MemberInquiryStore,
    @inject(INQUIRY_TYPES.InquiryAttachmentBinder)
    private readonly attachments: InquiryAttachmentBinder,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async view(
    session: SessionView,
    inquiryId: string,
  ): Promise<MemberInquiryView | undefined> {
    const { user } = await this.guard.requireUser(session);
    const inquiry = await this.store.findById(inquiryId);
    if (!isVisibleTo(inquiry, user)) {
      return undefined;
    }
    const messages = await this.store.listMessages(inquiry.id);
    return { inquiry, messages, canPost: user.status !== 'suspended' };
  }

  async post(
    session: SessionView,
    inquiryId: string,
    input: InquiryMessageInput,
    now: Date,
  ): Promise<InquiryMessageRecord> {
    const { user } = await this.guard.requireWritableUser(session);
    const inquiry = await this.store.findById(inquiryId);
    if (!isVisibleTo(inquiry, user)) {
      throw inquiryError('inquiry_not_found');
    }
    const body = validBodyOf(input.body);
    const fileIds = await this.attachments.bind(user.id, input.fileIds);
    const message = { id: this.ids.generate(), body, fileIds, at: now };
    const result = await this.appendOrRelease(
      inquiry,
      message,
      statusAfterUserMessage(inquiry.status),
    );
    if (result === 'not-found') {
      await this.attachments.release(fileIds);
      throw inquiryError('inquiry_not_found');
    }
    return {
      id: message.id,
      inquiryId: inquiry.id,
      sender: 'user',
      adminId: null,
      body,
      fileIds,
      createdAt: now,
    };
  }

  async listMine(
    session: SessionView,
    after: string | undefined,
  ): Promise<MemberInquiryPage> {
    const { user } = await this.guard.requireUser(session);
    return this.store.listByUser(
      user.id,
      after === undefined
        ? { limit: MY_INQUIRY_PAGE_SIZE }
        : { after, limit: MY_INQUIRY_PAGE_SIZE },
    );
  }

  private async appendOrRelease(
    inquiry: MemberInquiryRecord,
    message: NewInquiryMessage,
    nextStatus: InquiryStatus,
  ): Promise<'appended' | 'not-found'> {
    try {
      return await this.store.appendUserMessage(
        inquiry.id,
        message,
        nextStatus,
      );
    } catch (error: unknown) {
      await this.attachments.release(message.fileIds);
      throw error;
    }
  }
}
