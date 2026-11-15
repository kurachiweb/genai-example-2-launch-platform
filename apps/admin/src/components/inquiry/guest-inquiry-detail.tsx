import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { InquiryStatusBadge } from '../../../lib/components/inquiry/inquiry-status-badge.tsx';
import type { AdminGuestInquiryView } from '../../graphql/admin-inquiries.ts';
import {
  CATEGORY_LABEL,
  CONTACT_EMAIL_LABEL,
  GUEST_BODY_LABEL,
  GUEST_NICKNAME_LABEL,
  GUEST_REPLY_NOTICE,
  INQUIRY_KIND_LABELS,
  KIND_LABEL,
  RECEIVED_AT_LABEL,
  STATUS_LABEL,
} from './admin-inquiries-messages.ts';

export interface GuestInquiryDetailProps {
  readonly inquiry: AdminGuestInquiryView;
}

// 未ログインの問い合わせにはシステムから返信できないため、連絡先と、システム外のメールで回答する旨を示す
export function GuestInquiryDetail({ inquiry }: GuestInquiryDetailProps) {
  const { guest } = inquiry;
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm">
        {GUEST_REPLY_NOTICE}
      </p>
      <dl className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{KIND_LABEL}</dt>
        <dd>{INQUIRY_KIND_LABELS.guest}</dd>
        <dt className="text-muted-foreground">{GUEST_NICKNAME_LABEL}</dt>
        <dd className="font-bold wrap-anywhere whitespace-pre-wrap">
          {guest.nickname}
        </dd>
        <dt className="text-muted-foreground">{CONTACT_EMAIL_LABEL}</dt>
        <dd className="break-all">{guest.email}</dd>
        <dt className="text-muted-foreground">{CATEGORY_LABEL}</dt>
        <dd className="wrap-anywhere">{inquiry.categoryName}</dd>
        <dt className="text-muted-foreground">{STATUS_LABEL}</dt>
        <dd>
          <InquiryStatusBadge status={inquiry.status} />
        </dd>
        <dt className="text-muted-foreground">{RECEIVED_AT_LABEL}</dt>
        <dd>
          <DateTime value={inquiry.createdAt} format="longDateTime" />
        </dd>
        <dt className="text-muted-foreground">{GUEST_BODY_LABEL}</dt>
        <dd className="rounded-lg border border-border bg-card px-3 py-2 wrap-anywhere whitespace-pre-wrap text-card-foreground">
          {guest.body}
        </dd>
      </dl>
    </div>
  );
}
