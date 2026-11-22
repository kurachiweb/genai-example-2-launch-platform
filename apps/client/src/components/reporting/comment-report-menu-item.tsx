import { FlagIcon } from 'lucide-react';

import { DropdownMenuItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-item.tsx';
import type { CommentActionItemProps } from '../engagement/comment-action-types.ts';
import { REPORT_ACTION_LABELS } from './report-messages.ts';

// 他者の表示中のコメントのメニューにだけ描かれるため、表示の条件を持たない
export function CommentReportMenuItem({ onSelect }: CommentActionItemProps) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <FlagIcon aria-hidden="true" />
      {REPORT_ACTION_LABELS.comment}
    </DropdownMenuItem>
  );
}
