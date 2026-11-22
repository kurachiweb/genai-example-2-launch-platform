import { useQuery } from '@tanstack/react-query';
import type { RefObject } from 'react';

import type { ReportTargetKind } from '../../../common-lib/reporting/report-rules.ts';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import {
  reportCategoriesQueryOptions,
  toReportCategoryOptions,
} from '../../graphql/reporting.ts';
import { ReportForm } from './report-form.tsx';
import { REPORT_DIALOG_TITLES, REPORT_MESSAGES } from './report-messages.ts';

export interface ReportDialogProps {
  readonly targetKind: ReportTargetKind;
  // ユーザーはハンドル、プロダクトとコメントはID
  readonly targetRef: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // 閉じた後にフォーカスを戻す、開いた元の操作(メニューは「…」のボタン)
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

interface ReportDialogBodyProps {
  readonly targetKind: ReportTargetKind;
  readonly targetRef: string;
  readonly title: string;
  readonly onSubmitted: () => void;
}

// ダイアログの中身は開いている間だけ描かれるため、カテゴリは開いた時に取得し、閉じた後の入力を残さない
function ReportDialogBody({
  targetKind,
  targetRef,
  title,
  onSubmitted,
}: ReportDialogBodyProps) {
  const categories = useQuery({
    ...reportCategoriesQueryOptions(),
    select: toReportCategoryOptions,
  });

  if (categories.isPending) {
    return (
      <LoadingSkeleton>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-32 w-full" />
        </div>
      </LoadingSkeleton>
    );
  }
  if (categories.isError) {
    return (
      <PartialErrorState
        message={REPORT_MESSAGES.categoriesLoadError}
        onRetry={() => {
          void categories.refetch();
        }}
      />
    );
  }
  return (
    <ReportForm
      targetKind={targetKind}
      targetRef={targetRef}
      categories={categories.data}
      label={title}
      onSubmitted={onSubmitted}
    />
  );
}

export function ReportDialog({
  targetKind,
  targetRef,
  open,
  onOpenChange,
  returnFocusRef,
}: ReportDialogProps) {
  const title = REPORT_DIALOG_TITLES[targetKind];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        // 開く元の操作をDialogTriggerにしない呼び出し方では、Radix UIが閉じた後のフォーカスの戻り先を持たないため、開いた元の操作へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef.current;
          if (target?.isConnected === true) {
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {REPORT_MESSAGES.dialogDescription}
          </DialogDescription>
        </DialogHeader>
        <ReportDialogBody
          targetKind={targetKind}
          targetRef={targetRef}
          title={title}
          onSubmitted={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
