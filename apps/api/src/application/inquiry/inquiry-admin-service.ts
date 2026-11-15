import { inject, injectable } from 'inversify';

import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  AdminInquiryFilter,
  AdminInquiryPage,
  GuestInquiryRecord,
  InquirerProfile,
  InquirerProfiles,
  InquiryAdminReader,
  InquiryMessageRecord,
  MemberInquiryRecord,
  MemberInquiryStore,
} from './ports.ts';

const ADMIN_INQUIRY_PAGE_SIZE = 50;

export interface AdminMemberInquiryView {
  readonly kind: 'member';
  readonly inquiry: MemberInquiryRecord;
  readonly withdrawn: boolean;
  // 送った利用者を照会口が返さなければundefined
  readonly member: InquirerProfile | undefined;
  // 送信日時の古い順
  readonly messages: readonly InquiryMessageRecord[];
}

export interface AdminGuestInquiryView {
  readonly kind: 'guest';
  readonly inquiry: GuestInquiryRecord;
  readonly withdrawn: false;
}

export type AdminInquiryView = AdminMemberInquiryView | AdminGuestInquiryView;

// いずれも閲覧のみ以上の認可を通したリゾルバから呼ぶ
export interface InquiryAdminService {
  list(
    filter: AdminInquiryFilter,
    after: string | undefined,
  ): Promise<AdminInquiryPage>;
  detail(id: string): Promise<AdminInquiryView | undefined>;
  // 退会済みの問い合わせを数えない
  unhandledCount(): Promise<number>;
}

@injectable()
export class StoreInquiryAdminService implements InquiryAdminService {
  constructor(
    @inject(INQUIRY_TYPES.InquiryAdminReader)
    private readonly reader: InquiryAdminReader,
    @inject(INQUIRY_TYPES.MemberInquiryStore)
    private readonly memberInquiries: MemberInquiryStore,
    @inject(INQUIRY_TYPES.InquirerProfiles)
    private readonly profiles: InquirerProfiles,
  ) {}

  list(
    filter: AdminInquiryFilter,
    after: string | undefined,
  ): Promise<AdminInquiryPage> {
    return this.reader.list(
      filter,
      after === undefined
        ? { limit: ADMIN_INQUIRY_PAGE_SIZE }
        : { after, limit: ADMIN_INQUIRY_PAGE_SIZE },
    );
  }

  async detail(id: string): Promise<AdminInquiryView | undefined> {
    const detail = await this.reader.findDetail(id);
    if (detail === undefined) {
      return undefined;
    }
    if (detail.kind === 'guest') {
      return { kind: 'guest', inquiry: detail.inquiry, withdrawn: false };
    }
    const { inquiry } = detail;
    const [messages, profiles] = await Promise.all([
      this.memberInquiries.listMessages(inquiry.id),
      this.profiles.findMany([inquiry.userId]),
    ]);
    return {
      kind: 'member',
      inquiry,
      // ログインの問い合わせの論理削除は退会の確定でだけ行う
      withdrawn: inquiry.deletedAt !== null,
      member: profiles.get(inquiry.userId),
      messages,
    };
  }

  unhandledCount(): Promise<number> {
    return this.reader.countUnhandled();
  }
}
