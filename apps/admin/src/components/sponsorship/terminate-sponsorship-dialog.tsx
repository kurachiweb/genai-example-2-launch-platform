import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RefObject } from 'react';

import {
  ConfirmActionDialog,
  type ConfirmActionInput,
} from '../../../lib/components/admin/confirm-action-dialog.tsx';
import { MoneyText } from '../../../lib/components/payments/money-text.tsx';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
  requireData,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';
import { LOADING_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  type AdminSponsorshipTerminationPreview,
  type AdminSponsorshipTerminationResult,
  adminSponsorshipTerminationPreviewQueryOptions,
} from '../../graphql/admin-sponsorships.ts';
import {
  AdminSponsorshipsDocument,
  AdminSponsorshipTerminationPreviewDocument,
  AdminTerminateSponsorshipDocument,
} from '../../graphql/generated/graphql.ts';
import {
  TERMINATE_CONFIRM_LABEL,
  TERMINATE_DIALOG_TITLE,
  TERMINATION_AUTO_REFUND_NOTICE,
  TERMINATION_ESTIMATE_TEXT,
  TERMINATION_STOP_REFUND_TEXT,
} from './termination-messages.ts';

const NOT_TERMINABLE_CODE = 'sponsorship_not_terminable';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

interface TerminationEstimateProps {
  readonly preview: AdminSponsorshipTerminationPreview;
}

function TerminationEstimate({ preview }: TerminationEstimateProps) {
  return (
    <>
      {TERMINATION_ESTIMATE_TEXT.beforeUnexposedDays}
      {preview.unexposedDays}
      {TERMINATION_ESTIMATE_TEXT.beforeRefundEstimate}
      <MoneyText amount={preview.refundEstimate.amount} />
      {TERMINATION_ESTIMATE_TEXT.beforeAmountPaid}
      <MoneyText amount={preview.amountPaid.amount} />
      {TERMINATION_ESTIMATE_TEXT.beforeDays}
      {preview.days}
      {TERMINATION_ESTIMATE_TEXT.after}
      {preview.stoppedDays > 0 ? (
        <>
          {TERMINATION_STOP_REFUND_TEXT.beforeStoppedDays}
          {preview.stoppedDays}
          {TERMINATION_STOP_REFUND_TEXT.beforeStopRefundAmount}
          <MoneyText amount={preview.stopRefundAmount.amount} />
          {TERMINATION_STOP_REFUND_TEXT.after}
        </>
      ) : null}
      {TERMINATION_AUTO_REFUND_NOTICE}
    </>
  );
}

export interface TerminateSponsorshipDialogProps {
  // 閉じた後も閉じる動きの間の説明を保つため、最後に開いた申込のIDを渡し続ける
  readonly sponsorshipId: string | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onTerminated: (result: AdminSponsorshipTerminationResult) => void;
  // 強制終了できない拒否を受けたとき。開いた元の行は一覧の取り直しで消え得る
  readonly onNotTerminable: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

// 開いたときに未掲載日数と返金目安額を照会して示し、理由を入力した確定で強制終了する
export function TerminateSponsorshipDialog({
  sponsorshipId,
  open,
  onOpenChange,
  onTerminated,
  onNotTerminable,
  returnFocusRef,
}: TerminateSponsorshipDialogProps) {
  const queryClient = useQueryClient();

  const refreshList = (): Promise<void> =>
    queryClient.invalidateQueries({
      queryKey: [documentIdOf(AdminSponsorshipsDocument)],
    });

  // 表示中の一覧の後に強制終了・終了した広告は照会と確定のどちらでも拒否されるため、どちらでも一覧を取り直す
  const rethrowAfterNotTerminable = (error: unknown): never => {
    if (
      error instanceof GraphQLClientError &&
      error.code === NOT_TERMINABLE_CODE
    ) {
      void refreshList();
      onNotTerminable();
    }
    throw error;
  };

  const previewId = sponsorshipId ?? '';
  const preview = useQuery({
    ...adminSponsorshipTerminationPreviewQueryOptions(previewId),
    // 取得の補助と同じ実行に、拒否を受けたときの一覧の取り直しを足す
    queryFn: async ({ signal }) => {
      try {
        return requireData(
          await executeGraphQL(
            AdminSponsorshipTerminationPreviewDocument,
            { id: previewId },
            { signal },
          ),
        );
      } catch (error) {
        return rethrowAfterNotTerminable(error);
      }
    },
    select: (data) => data.sponsorshipTerminationPreview,
    enabled: open && sponsorshipId !== undefined,
    // 未掲載日数と表示停止の日数は0:00や表示停止の始まりで変わるため、開くたびに読み直す
    staleTime: 0,
  });
  const terminate = useMutation(
    graphqlMutationOptions(AdminTerminateSponsorshipDocument),
  );

  const confirm = async ({ reason }: ConfirmActionInput): Promise<void> => {
    if (sponsorshipId === undefined || reason === undefined) {
      return;
    }
    const { terminateSponsorship } = await terminate
      .mutateAsync({ variables: { id: sponsorshipId, reason } })
      .catch(rethrowAfterNotTerminable);
    onTerminated(terminateSponsorship);
    void refreshList();
  };

  const description =
    preview.data !== undefined ? (
      <TerminationEstimate preview={preview.data} />
    ) : preview.isError && !preview.isFetching ? (
      <span role="alert">{failureMessageOf(preview.error)}</span>
    ) : (
      LOADING_LABEL
    );

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={TERMINATE_DIALOG_TITLE}
      description={description}
      confirmLabel={TERMINATE_CONFIRM_LABEL}
      reason="required"
      audited
      onConfirm={confirm}
      failureMessageOf={failureMessageOf}
      confirmDisabled={preview.data === undefined}
      {...(returnFocusRef === undefined ? {} : { returnFocusRef })}
    />
  );
}
