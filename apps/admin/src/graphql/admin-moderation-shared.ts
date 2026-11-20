import type { QuarantineReason } from '../../common-lib/moderation/moderation-labels.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import type { GraphQLMutationInput } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  type DocumentId,
  documentIdOf,
  type PersistedDocument,
} from '../../lib/utilities/graphql/persisted-document.ts';

export interface AdminModerationPage<TItem> {
  readonly items: readonly TItem[];
  // nullは続きが無い
  readonly nextCursor: string | null;
}

export interface ModerationNoteView {
  // nullは理由を任意とする措置で理由が無い
  readonly reason: string | null;
  readonly occurredAt: string;
}

export interface AdminMediaFileView {
  readonly id: string;
  // 管理者側のサイトと同じオリジンの中継の経路
  readonly path: string;
  readonly quarantined: boolean;
  readonly quarantineReasons: readonly QuarantineReason[];
}

export interface AdminUserSummaryView {
  readonly id: string;
  readonly handle: string;
  readonly nickname: string;
  readonly suspended: boolean;
}

export interface ModerationActionInput {
  readonly targetId: string;
  readonly reason: string;
}

export interface ModerationOutcomeView {
  // 偽は既に同じ状態だった
  readonly changed: boolean;
}

export interface ModerationActionOptions {
  readonly mutationKey: readonly [DocumentId];
  readonly mutationFn: (
    input: GraphQLMutationInput<ModerationActionInput>,
  ) => Promise<ModerationOutcomeView>;
}

const QUARANTINE_REASON_OF = Object.freeze({
  AUTO: 'auto',
  PRODUCT_HIDDEN: 'product_hidden',
  USER_SUSPENDED: 'user_suspended',
  ADMIN_ACTION: 'admin_action',
} as const satisfies Record<string, QuarantineReason>);

export type GraphQLQuarantineReason = keyof typeof QUARANTINE_REASON_OF;

export const GRAPHQL_QUARANTINE_REASON_OF: Readonly<
  Record<QuarantineReason, GraphQLQuarantineReason>
> = Object.freeze({
  auto: 'AUTO',
  product_hidden: 'PRODUCT_HIDDEN',
  user_suspended: 'USER_SUSPENDED',
  admin_action: 'ADMIN_ACTION',
});

interface GraphQLConnection<TNode> {
  readonly nodes: readonly TNode[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor?: string | null;
  };
}

interface GraphQLMediaFile {
  readonly id: string;
  readonly path: string;
  readonly quarantined: boolean;
  readonly quarantineReasons: readonly GraphQLQuarantineReason[];
}

export const toModerationPage = <TNode, TItem>(
  { nodes, pageInfo }: GraphQLConnection<TNode>,
  toItem: (node: TNode) => TItem,
): AdminModerationPage<TItem> => ({
  items: nodes.map(toItem),
  nextCursor: pageInfo.hasNextPage ? (pageInfo.endCursor ?? null) : null,
});

export const toModerationNote = (
  note: ModerationNoteView | null,
): ModerationNoteView | null =>
  note === null ? null : { reason: note.reason, occurredAt: note.occurredAt };

export function toAdminMediaFile(file: GraphQLMediaFile): AdminMediaFileView;
export function toAdminMediaFile(
  file: GraphQLMediaFile | null,
): AdminMediaFileView | null;
// GraphQLの列挙は大文字のため、表示名を引く共用部品の値へ写す
export function toAdminMediaFile(
  file: GraphQLMediaFile | null,
): AdminMediaFileView | null {
  return file === null
    ? null
    : {
        id: file.id,
        path: file.path,
        quarantined: file.quarantined,
        quarantineReasons: file.quarantineReasons.map(
          (reason) => QUARANTINE_REASON_OF[reason],
        ),
      };
}

export const toAdminUserSummary = (
  summary: AdminUserSummaryView | null,
): AdminUserSummaryView | null =>
  summary === null
    ? null
    : {
        id: summary.id,
        handle: summary.handle,
        nickname: summary.nickname,
        suspended: summary.suspended,
      };

// 13の措置の操作は変数の名前と結果の項目が違うため、画面からは対象と理由の入力と変化の有無の結果にそろえて呼べるようにする
export function moderationActionOptions<TResult, TVariables>({
  document,
  variablesOf,
  outcomeOf,
}: {
  readonly document: PersistedDocument<TResult, TVariables>;
  readonly variablesOf: (input: ModerationActionInput) => TVariables;
  readonly outcomeOf: (result: TResult) => ModerationOutcomeView;
}): ModerationActionOptions {
  return {
    mutationKey: [documentIdOf(document)],
    mutationFn: async ({ variables }) => ({
      changed: outcomeOf(
        requireData(await executeGraphQL(document, variablesOf(variables))),
      ).changed,
    }),
  };
}
