import type { CommentAction } from '../components/engagement/comment-action-types.ts';
import { CommentReportDialog } from '../components/reporting/comment-report-dialog.tsx';
import { CommentReportMenuItem } from '../components/reporting/comment-report-menu-item.tsx';

// 他者のコメントの「…」メニューに並べる操作の登録箇所。各specが自分の操作を追記する
export const COMMENT_ACTIONS: readonly CommentAction[] = Object.freeze([
  {
    id: 'content-reporting.comment-report',
    order: 10,
    Item: CommentReportMenuItem,
    Dialog: CommentReportDialog,
  },
]);
