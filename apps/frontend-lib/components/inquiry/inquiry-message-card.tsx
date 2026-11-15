import type { ReactNode } from 'react';

import { cn } from '../../utilities/class-names.ts';
import { DateTime } from '../datetime/date-time.tsx';
import {
  InquiryAttachmentList,
  type InquiryAttachmentView,
} from './inquiry-attachment-list.tsx';

export type InquiryMessageSide = 'self' | 'other';

export interface InquiryMessageCardProps {
  // 閲覧者から見た配置
  readonly side: InquiryMessageSide;
  readonly senderLabel: string;
  readonly avatar: ReactNode;
  // プレーンテキスト
  readonly body: string;
  readonly attachments: readonly InquiryAttachmentView[];
  // ISO 8601
  readonly createdAt: string;
  readonly className?: string;
}

export function InquiryMessageCard({
  side,
  senderLabel,
  avatar,
  body,
  attachments,
  createdAt,
  className,
}: InquiryMessageCardProps) {
  const isSelf = side === 'self';
  return (
    <article
      data-slot="inquiry-message-card"
      data-side={side}
      className={cn(
        'flex min-w-0 items-start gap-3',
        isSelf && 'flex-row-reverse',
        className,
      )}
    >
      <div className="shrink-0">{avatar}</div>
      <div
        className={cn(
          'flex max-w-[85%] min-w-0 flex-col gap-1.5',
          isSelf ? 'items-end' : 'items-start',
        )}
      >
        <header
          className={cn(
            'flex max-w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5',
            isSelf && 'justify-end',
          )}
        >
          <span className="min-w-0 text-sm font-medium wrap-anywhere">
            {senderLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            <DateTime value={createdAt} format="longDateTime" />
          </span>
        </header>
        <p
          className={cn(
            'max-w-full rounded-lg border px-3 py-2 text-sm wrap-anywhere whitespace-pre-wrap',
            isSelf
              ? 'border-primary/30 bg-primary/10 text-foreground'
              : 'border-border bg-card text-card-foreground',
          )}
        >
          {body}
        </p>
        <InquiryAttachmentList
          attachments={attachments}
          className="max-w-full"
        />
      </div>
    </article>
  );
}
