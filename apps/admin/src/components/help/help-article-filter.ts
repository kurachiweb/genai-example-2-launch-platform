import {
  HELP_ARTICLE_STATUSES,
  type HelpArticleStatus,
} from '../../../common-lib/help/help-article-status.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { HELP_DELETED_AUTHOR_LABEL } from './help-messages.ts';

// 作成者は管理者のID、または削除された管理者の記事をまとめた値
export interface HelpArticleFilter {
  readonly creator?: string | undefined;
  readonly category?: string | undefined;
  readonly status?: HelpArticleStatus | undefined;
}

export interface HelpArticleFilterOption {
  readonly value: string;
  readonly label: string;
}

export const DELETED_CREATOR_VALUE = 'deleted';

// APIのIDの入力の上限と同じ長さ
const ID_MAX = 64;

const isHelpArticleStatus = (value: unknown): value is HelpArticleStatus =>
  (HELP_ARTICLE_STATUSES as readonly unknown[]).includes(value);

const idField = z.string().min(1).max(ID_MAX).optional().catch(undefined);

// 共有されたURLや手で書き換えたURLの不正な値は、一覧を表示できなくせず、その条件を未指定として扱う
const FILTER_SCHEMA = z.object({
  creator: idField,
  category: idField,
  status: z
    .custom<HelpArticleStatus>(isHelpArticleStatus)
    .optional()
    .catch(undefined),
});

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に全ての項目を返す
export const parseHelpArticleFilter = (
  search: Readonly<Record<string, unknown>>,
): HelpArticleFilter => {
  const { creator, category, status } = FILTER_SCHEMA.parse(search);
  return { creator, category, status };
};

// 項目の順や未指定の書き方に依らない、条件の1つの値
export const helpArticleFilterScopeOf = ({
  creator,
  category,
  status,
}: HelpArticleFilter): string =>
  JSON.stringify([creator ?? null, category ?? null, status ?? null]);

const nicknameOrder = new Intl.Collator('ja');

export function buildCreatorOptions(
  rows: readonly {
    readonly creatorAdminId: string;
    readonly creator: { readonly nickname: string } | null;
  }[],
): readonly HelpArticleFilterOption[] {
  const creators = new Map<string, string>();
  let hasDeleted = false;
  for (const { creatorAdminId, creator } of rows) {
    if (creator === null) {
      hasDeleted = true;
    } else {
      creators.set(creatorAdminId, creator.nickname);
    }
  }
  const options = [...creators]
    .map(([value, label]) => ({ value, label }))
    .toSorted(
      (left, right) =>
        nicknameOrder.compare(left.label, right.label) ||
        (left.value < right.value ? -1 : 1),
    );
  return hasDeleted
    ? [
        ...options,
        { value: DELETED_CREATOR_VALUE, label: HELP_DELETED_AUTHOR_LABEL },
      ]
    : options;
}

const matchesCreator = (
  row: { readonly creatorAdminId: string; readonly creator: object | null },
  creator: string,
): boolean =>
  creator === DELETED_CREATOR_VALUE
    ? row.creator === null
    : row.creatorAdminId === creator;

export function filterHelpArticles<
  T extends {
    readonly creatorAdminId: string;
    readonly creator: object | null;
    readonly categoryId: string;
    readonly status: HelpArticleStatus;
  },
>(
  rows: readonly T[],
  { creator, category, status }: HelpArticleFilter,
): readonly T[] {
  return rows.filter(
    (row) =>
      (creator === undefined || matchesCreator(row, creator)) &&
      (category === undefined || row.categoryId === category) &&
      (status === undefined || row.status === status),
  );
}
