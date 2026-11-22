import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';

import type { ReportTargetKind } from '../../../../common-lib/reporting/report-rules.ts';
import { notify } from '../../../../lib/components/feedback/notify.ts';
import { GraphQLClientError } from '../../../../lib/utilities/graphql/graphql-result.ts';
import { invalidateAuditLogQueries } from '../../../graphql/admin-audit-logs.ts';
import {
  changeReportCaseStatusMutationOptions,
  type InfringementInquiryInput,
  type InfringementInquiryOutcomeView,
  invalidateReportCaseQueries,
  type ReportCaseClosingInput,
  reportCaseClosingMutationOptions,
  type ReportCaseMutationOptions,
  type ReportCaseOutcomeView,
  type ReportCaseStatusChangeInput,
  sendInfringementInquiryMutationOptions,
} from '../../../graphql/admin-reporting-cases.ts';
import { invalidateReportSummaryQueries } from '../../../graphql/admin-reporting-summaries.ts';
import { invalidateModerationAffectedQueries } from '../../moderation/shared/use-moderation-mutation.ts';
import { reportCaseChangedMessage } from './report-messages.ts';

interface ReportCaseOperationTypes {
  readonly 'change-status': {
    readonly input: ReportCaseStatusChangeInput;
    readonly outcome: ReportCaseOutcomeView;
  };
  readonly 'resolve-with-measure': {
    readonly input: ReportCaseClosingInput;
    readonly outcome: ReportCaseOutcomeView;
  };
  readonly 'resolve-without-measure': {
    readonly input: ReportCaseClosingInput;
    readonly outcome: ReportCaseOutcomeView;
  };
  readonly reject: {
    readonly input: ReportCaseClosingInput;
    readonly outcome: ReportCaseOutcomeView;
  };
  readonly 'send-inquiry': {
    readonly input: InfringementInquiryInput;
    readonly outcome: InfringementInquiryOutcomeView;
  };
}

export type ReportCaseOperation = keyof ReportCaseOperationTypes;

type InputOf<TOperation extends ReportCaseOperation> =
  ReportCaseOperationTypes[TOperation]['input'];

type OutcomeOf<TOperation extends ReportCaseOperation> =
  ReportCaseOperationTypes[TOperation]['outcome'];

const optionsOf = <TOperation extends ReportCaseOperation>(
  operation: TOperation,
): ReportCaseMutationOptions<InputOf<TOperation>, OutcomeOf<TOperation>> => {
  const options =
    operation === 'change-status'
      ? changeReportCaseStatusMutationOptions()
      : operation === 'send-inquiry'
        ? sendInfringementInquiryMutationOptions()
        : reportCaseClosingMutationOptions(operation);
  return options as unknown as ReportCaseMutationOptions<
    InputOf<TOperation>,
    OutcomeOf<TOperation>
  >;
};

const TARGET_UNAVAILABLE = 'report_target_unavailable';

// UGC管理の規約は対象の不在だけで一覧を取り直すが、案件の一覧は行ごとに状態と行える操作を示すため、完了済み・競合・案件の不在でも表示中の行が古く、取り直さないと古い行から同じ失敗の操作を繰り返す
const REFRESH_FAILURE_CODES: ReadonlySet<string> = new Set([
  TARGET_UNAVAILABLE,
  'report_case_closed',
  'report_case_state_conflict',
  'report_case_not_found',
]);

export const isReportCaseRefreshFailure = (error: unknown): boolean =>
  error instanceof GraphQLClientError && REFRESH_FAILURE_CODES.has(error.code);

const invalidateReportingQueries = async (
  queryClient: QueryClient,
): Promise<void> => {
  await Promise.all([
    invalidateReportCaseQueries(queryClient),
    invalidateReportSummaryQueries(queryClient),
  ]);
};

export interface ReportCaseMutationOptionsOf {
  readonly targetKind: ReportTargetKind;
  // 詳細のページのように、取り直しで確認の前提や画面ごとが替わる場所では、失敗の後の取り直しを呼び出し元へ任せる
  readonly deferRefresh?: boolean;
}

export interface ReportCaseMutation<TOperation extends ReportCaseOperation> {
  readonly run: (input: InputOf<TOperation>) => Promise<OutcomeOf<TOperation>>;
  // 取り直す失敗なら案件の照会(対象の不在ではUGC管理の影響する照会も)を無効にする。取り直しを遅らせた呼び出し元が閉じた時に呼ぶ
  readonly refreshAfter: (error: unknown) => Promise<void>;
}

// 案件の操作を行い、成功では案件と件数と監査ログ(措置ではUGC管理の影響する照会も)を無効にしてから知らせる。失敗は例外のまま呼び出し元へ返し、監査ログが残らないため監査ログの照会は無効にしない
export function useReportCaseMutation<TOperation extends ReportCaseOperation>(
  operation: TOperation,
  { targetKind, deferRefresh = false }: ReportCaseMutationOptionsOf,
): ReportCaseMutation<TOperation> {
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(optionsOf(operation));
  // 呼び出し元が部品の外れる時の後始末に使うため、描画のたびに参照を変えない
  const refreshAfter = useCallback(
    async (error: unknown): Promise<void> => {
      if (!isReportCaseRefreshFailure(error)) {
        return;
      }
      await Promise.all([
        invalidateReportingQueries(queryClient),
        ...(error instanceof GraphQLClientError &&
        error.code === TARGET_UNAVAILABLE
          ? [invalidateModerationAffectedQueries(queryClient, targetKind)]
          : []),
      ]);
    },
    [queryClient, targetKind],
  );

  const run = async (
    input: InputOf<TOperation>,
  ): Promise<OutcomeOf<TOperation>> => {
    let outcome: OutcomeOf<TOperation>;
    try {
      outcome = await mutateAsync({ variables: input });
    } catch (error) {
      if (!deferRefresh) {
        await refreshAfter(error);
      }
      throw error;
    }
    await Promise.all([
      invalidateReportingQueries(queryClient),
      invalidateAuditLogQueries(queryClient),
      ...(operation === 'resolve-with-measure'
        ? [invalidateModerationAffectedQueries(queryClient, targetKind)]
        : []),
    ]);
    notify.success(reportCaseChangedMessage(outcome));
    return outcome;
  };

  return { run, refreshAfter };
}
