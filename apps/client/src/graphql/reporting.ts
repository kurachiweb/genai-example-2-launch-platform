import {
  graphqlMutationOptions,
  graphqlQueryOptions,
} from '../../lib/start/graphql/graphql-query-options.ts';
import type { ReportTargetKind } from '../../common-lib/reporting/report-rules.ts';
import {
  ClientReportCategoriesDocument,
  type ClientReportCategoriesQuery,
  ClientSubmitReportDocument,
  type ClientSubmitReportMutationVariables,
  type ReportTargetKind as GraphQLReportTargetKind,
} from './generated/graphql.ts';

export interface ReportCategoryOption {
  readonly id: string;
  readonly name: string;
  readonly infringement: boolean;
}

export interface ReportSubmission {
  readonly targetKind: ReportTargetKind;
  readonly targetRef: string;
  readonly categoryId: string;
  readonly reason: string;
  // 連絡先の欄を描いている間だけ持つ
  readonly contactEmail?: string;
}

const GRAPHQL_TARGET_KIND_OF: Readonly<
  Record<ReportTargetKind, GraphQLReportTargetKind>
> = Object.freeze({ user: 'USER', product: 'PRODUCT', comment: 'COMMENT' });

// カテゴリは閲覧者によらないため、共通の取得の補助をそのまま使い、通報の操作を持つ複数のダイアログの取得を1つにまとめる
export const reportCategoriesQueryOptions = () =>
  graphqlQueryOptions(ClientReportCategoriesDocument, {});

export const toReportCategoryOptions = ({
  reportCategories,
}: ClientReportCategoriesQuery): readonly ReportCategoryOption[] =>
  reportCategories.map(({ id, name, infringement }) => ({
    id,
    name,
    infringement,
  }));

// GraphQLの列挙は大文字のため、共用部品の対象の種類を写す。連絡先は描いていない間に送らないよう、値が無ければ入力に含めない
export const toSubmitReportVariables = ({
  targetKind,
  targetRef,
  categoryId,
  reason,
  contactEmail,
}: ReportSubmission): ClientSubmitReportMutationVariables => {
  const input = {
    targetKind: GRAPHQL_TARGET_KIND_OF[targetKind],
    targetRef,
    categoryId,
    reason,
  };
  return {
    input: contactEmail === undefined ? input : { ...input, contactEmail },
  };
};

export const submitReportMutationOptions = () =>
  graphqlMutationOptions(ClientSubmitReportDocument);
