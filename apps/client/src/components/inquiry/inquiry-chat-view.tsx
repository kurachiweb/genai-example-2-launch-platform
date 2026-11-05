import { useSuspenseQuery } from '@tanstack/react-query';
import { notFound } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { InquirerAvatar } from '../../../lib/components/inquiry/inquirer-avatar.tsx';
import { InquiryAutoRefreshSwitch } from '../../../lib/components/inquiry/inquiry-auto-refresh-switch.tsx';
import { InquiryMessageCard } from '../../../lib/components/inquiry/inquiry-message-card.tsx';
import { InquiryStatusBadge } from '../../../lib/components/inquiry/inquiry-status-badge.tsx';
import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import {
  type InquiryChatMessage,
  memberInquiryQueryOptions,
  toInquiryChat,
} from '../../graphql/inquiry-chat.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import {
  DELETED_ADMIN_LABEL,
  INQUIRY_MESSAGES_TITLE,
  INQUIRY_STATUS_LABEL,
} from './inquiry-chat-messages.ts';
import { CATEGORY_LABEL, SENT_AT_LABEL } from './inquiry-contact-messages.ts';
import { InquiryMessageComposer } from './inquiry-message-composer.tsx';
import { SuspendedChatNotice } from './suspended-chat-notice.tsx';

export interface InquiryChatViewProps {
  readonly viewer: ClientViewer;
  readonly inquiryId: string;
}

interface ChatMessageItemProps {
  readonly message: InquiryChatMessage;
  readonly viewerNickname: string;
}

// 利用者のアバターはチャットの取得に含めないため、自分のメッセージは既定のアイコンで示す
function ChatMessageItem({ message, viewerNickname }: ChatMessageItemProps) {
  const { sender } = message;
  const senderLabel =
    sender.kind === 'self'
      ? viewerNickname
      : sender.kind === 'admin'
        ? sender.nickname
        : DELETED_ADMIN_LABEL;
  return (
    <li>
      <InquiryMessageCard
        side={sender.kind === 'self' ? 'self' : 'other'}
        senderLabel={senderLabel}
        avatar={
          <InquirerAvatar
            image={sender.kind === 'admin' ? sender.avatar : null}
            nickname={senderLabel}
            size="xs"
          />
        }
        body={message.body}
        attachments={message.attachments}
        createdAt={message.createdAt}
      />
    </li>
  );
}

// 開いている間は30秒ごとに取り直す。自動で更新される情報には止める手段が要るため、自動更新を切り替えられるようにする
export function InquiryChatView({ viewer, inquiryId }: InquiryChatViewProps) {
  const headingId = useId();
  const [autoRefresh, setAutoRefresh] = useState(true);
  // 表示する前にloaderが毎回新しく取得しているため、表示した時点では取り直さず、loaderの取得とハイドレーションの直後の取得を重ねない
  const { data: chat } = useSuspenseQuery({
    ...memberInquiryQueryOptions(viewer, inquiryId),
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: autoRefresh
      ? LIVE_REFRESH_QUERY_OPTIONS.refetchInterval
      : false,
    refetchOnMount: false,
    select: toInquiryChat,
  });
  if (chat === undefined) {
    throw notFound();
  }

  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{CATEGORY_LABEL}</dt>
        <dd className="font-bold wrap-anywhere">{chat.categoryName}</dd>
        <dt className="text-muted-foreground">{INQUIRY_STATUS_LABEL}</dt>
        <dd>
          <InquiryStatusBadge status={chat.status} />
        </dd>
        <dt className="text-muted-foreground">{SENT_AT_LABEL}</dt>
        <dd>
          <DateTime value={chat.createdAt} format="longDateTime" />
        </dd>
      </dl>
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id={headingId} className="text-xl font-extrabold">
            {INQUIRY_MESSAGES_TITLE}
          </h2>
          <InquiryAutoRefreshSwitch
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
          />
        </div>
        {/* 取り直しで届いた新しいメッセージを支援技術へ伝えるため、追加を読み上げるログの領域にする */}
        <div role="log" aria-labelledby={headingId}>
          <ol className="flex flex-col gap-6">
            {chat.messages.map((message) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                viewerNickname={viewer.nickname}
              />
            ))}
          </ol>
        </div>
      </section>
      <div className="border-t border-border pt-8">
        {chat.canPost ? (
          <InquiryMessageComposer inquiryId={chat.id} />
        ) : (
          <SuspendedChatNotice />
        )}
      </div>
    </div>
  );
}
