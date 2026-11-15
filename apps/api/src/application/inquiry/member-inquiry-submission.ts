import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { InquiryAttachmentBinder } from './inquiry-attachment-binder.ts';
import { inquiryCategoryUnavailableError } from './inquiry-errors.ts';
import type { InquiryRequestMeta } from './inquiry-request-meta.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type { InquiryCategoryStore, MemberInquiryStore } from './ports.ts';

// 入力の規則による検証とbot判定はリゾルバが済ませてから渡す
export interface MemberInquiryInput {
  readonly categoryId: string;
  readonly body: string;
  readonly fileIds: readonly string[];
}

export interface MemberInquirySubmission {
  submit(
    session: SessionView,
    input: MemberInquiryInput,
    meta: InquiryRequestMeta,
  ): Promise<{ readonly inquiryId: string }>;
}

@injectable()
export class StoreMemberInquirySubmission implements MemberInquirySubmission {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(INQUIRY_TYPES.InquiryCategoryStore)
    private readonly categories: InquiryCategoryStore,
    @inject(INQUIRY_TYPES.InquiryAttachmentBinder)
    private readonly attachments: InquiryAttachmentBinder,
    @inject(INQUIRY_TYPES.MemberInquiryStore)
    private readonly store: MemberInquiryStore,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async submit(
    session: SessionView,
    input: MemberInquiryInput,
    meta: InquiryRequestMeta,
  ): Promise<{ readonly inquiryId: string }> {
    // メールアドレスの確認を問わず受け付けるため、確認済みを求めるrequireVerifiedUserは使わない
    const { user } = await this.guard.requireWritableUser(session);
    const category = await this.categories.findById(input.categoryId);
    if (category === undefined) {
      throw inquiryCategoryUnavailableError();
    }
    const fileIds = await this.attachments.bind(user.id, input.fileIds);
    const inquiryId = this.ids.generate();
    try {
      await this.store.insert({
        id: inquiryId,
        userId: user.id,
        categoryId: category.id,
        at: meta.now,
        firstMessage: {
          id: this.ids.generate(),
          body: input.body,
          fileIds,
          at: meta.now,
        },
      });
    } catch (error: unknown) {
      await this.attachments.release(fileIds);
      throw error;
    }
    return { inquiryId };
  }
}
