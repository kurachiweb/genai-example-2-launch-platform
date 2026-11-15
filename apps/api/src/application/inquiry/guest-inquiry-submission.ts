import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import {
  inquiryCategoryUnavailableError,
  inquiryError,
} from './inquiry-errors.ts';
import type { InquiryRequestMeta } from './inquiry-request-meta.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  GuestInquiryRateLimit,
  GuestInquiryStore,
  InquiryCategoryStore,
} from './ports.ts';

// 入力の規則による検証とbot判定はリゾルバが済ませてから渡す
export interface GuestInquiryInput {
  readonly categoryId: string;
  readonly nickname: string;
  readonly email: string;
  readonly body: string;
}

export interface GuestInquirySubmission {
  submit(
    session: SessionView,
    input: GuestInquiryInput,
    meta: InquiryRequestMeta,
  ): Promise<void>;
}

@injectable()
export class StoreGuestInquirySubmission implements GuestInquirySubmission {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(INQUIRY_TYPES.InquiryCategoryStore)
    private readonly categories: InquiryCategoryStore,
    @inject(INQUIRY_TYPES.GuestInquiryRateLimit)
    private readonly rateLimit: GuestInquiryRateLimit,
    @inject(INQUIRY_TYPES.GuestInquiryStore)
    private readonly store: GuestInquiryStore,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async submit(
    session: SessionView,
    input: GuestInquiryInput,
    meta: InquiryRequestMeta,
  ): Promise<void> {
    // 停止中の利用者は未ログインと同じに受け付け、送信をアカウントに紐付けないため利用者の情報を以降へ渡さない
    const current = await this.guard.currentUser(session);
    if (current?.user.status === 'active') {
      throw inquiryError('member_inquiry_required');
    }
    const category = await this.categories.findById(input.categoryId);
    if (category === undefined) {
      throw inquiryCategoryUnavailableError();
    }
    await this.rateLimit.consume(meta.clientIp, meta.now);
    await this.store.insert({
      id: this.ids.generate(),
      categoryId: category.id,
      nickname: input.nickname,
      email: input.email,
      body: input.body,
      at: meta.now,
    });
  }
}
