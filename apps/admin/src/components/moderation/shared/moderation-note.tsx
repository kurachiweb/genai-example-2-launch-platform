import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import type { ModerationNoteView } from '../../../graphql/admin-moderation-shared.ts';
import {
  MODERATION_REASON_LABEL,
  NO_MODERATION_RECORD_LABEL,
} from './moderation-messages.ts';

export interface ModerationNoteProps {
  readonly dateLabel: string;
  // 状態が持つ措置の日時(停止日時・非公開化した日時)。nullなら措置の記録の日時を示す
  readonly occurredAt: string | null;
  // nullは措置の記録が無い(保持期間を過ぎて削除された)
  readonly note: ModerationNoteView | null;
}

// 理由は利用者の入力のため、マークダウンやHTMLとして解釈せず、改行を保った文字列として示す
export function ModerationNote({
  dateLabel,
  occurredAt,
  note,
}: ModerationNoteProps) {
  const date = occurredAt ?? note?.occurredAt ?? null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {date === null ? null : (
        <>
          <dt className="text-muted-foreground">{dateLabel}</dt>
          <dd>
            <DateTime value={date} format="longDateTime" />
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">{MODERATION_REASON_LABEL}</dt>
      <dd className="break-words whitespace-pre-wrap">
        {note?.reason ?? NO_MODERATION_RECORD_LABEL}
      </dd>
    </dl>
  );
}
