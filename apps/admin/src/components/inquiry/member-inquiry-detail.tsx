import { useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { InquirerAvatar } from '../../../lib/components/inquiry/inquirer-avatar.tsx';
import { InquiryAutoRefreshSwitch } from '../../../lib/components/inquiry/inquiry-auto-refresh-switch.tsx';
import { InquiryMessageCard } from '../../../lib/components/inquiry/inquiry-message-card.tsx';
import { InquiryStatusBadge } from '../../../lib/components/inquiry/inquiry-status-badge.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import type {
  AdminInquiryMemberView,
  AdminInquiryMessageView,
  AdminMemberInquiryView,
} from '../../graphql/admin-inquiries.ts';
import {
  CATEGORY_LABEL,
  DELETED_ADMIN_LABEL,
  handleLabel,
  INQUIRY_KIND_LABELS,
  INQUIRY_MESSAGES_TITLE,
  KIND_LABEL,
  RECEIVED_AT_LABEL,
  SENDER_LABEL,
  STATUS_LABEL,
  UNREADABLE_MEMBER_LABEL,
  WITHDRAWN_LABEL,
} from './admin-inquiries-messages.ts';

export interface MemberInquiryDetailProps {
  readonly inquiry: AdminMemberInquiryView;
  readonly autoRefresh: boolean;
  readonly onAutoRefreshChange: (autoRefresh: boolean) => void;
}

interface MessageItemProps {
  readonly message: AdminInquiryMessageView;
  readonly member: AdminInquiryMemberView | null;
}

// 閲覧者は管理者のため、管理者の返信を自分の側に置く
function MessageItem({ message, member }: MessageItemProps) {
  const { sender } = message;
  const senderLabel =
    sender.kind === 'user'
      ? (member?.nickname ?? UNREADABLE_MEMBER_LABEL)
      : sender.kind === 'admin'
        ? sender.nickname
        : DELETED_ADMIN_LABEL;
  const avatar =
    sender.kind === 'user'
      ? (member?.avatar ?? null)
      : sender.kind === 'admin'
        ? sender.avatar
        : null;
  return (
    <li>
      <InquiryMessageCard
        side={sender.kind === 'user' ? 'other' : 'self'}
        senderLabel={senderLabel}
        avatar={
          <InquirerAvatar image={avatar} nickname={senderLabel} size="xs" />
        }
        body={message.body}
        attachments={message.attachments}
        createdAt={message.createdAt}
      />
    </li>
  );
}

export function MemberInquiryDetail({
  inquiry,
  autoRefresh,
  onAutoRefreshChange,
}: MemberInquiryDetailProps) {
  const headingId = useId();
  const { member } = inquiry;
  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{KIND_LABEL}</dt>
        <dd>{INQUIRY_KIND_LABELS.member}</dd>
        <dt className="text-muted-foreground">{SENDER_LABEL}</dt>
        <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {member === null ? (
            <span className="text-muted-foreground">
              {UNREADABLE_MEMBER_LABEL}
            </span>
          ) : (
            <>
              <span className="font-bold wrap-anywhere">{member.nickname}</span>
              <span className="wrap-anywhere text-muted-foreground">
                {handleLabel(member.handle)}
              </span>
            </>
          )}
          {inquiry.withdrawn ? (
            <Badge variant="outline">{WITHDRAWN_LABEL}</Badge>
          ) : null}
        </dd>
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
      </dl>
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id={headingId} className="text-lg font-semibold">
            {INQUIRY_MESSAGES_TITLE}
          </h2>
          <InquiryAutoRefreshSwitch
            checked={autoRefresh}
            onCheckedChange={onAutoRefreshChange}
          />
        </div>
        {/* 取り直しで届いた新しいメッセージを支援技術へ伝えるため、追加を読み上げるログの領域にする */}
        <div role="log" aria-labelledby={headingId}>
          <ol className="flex flex-col gap-6">
            {inquiry.messages.map((message) => (
              <MessageItem key={message.id} message={message} member={member} />
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
