import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ArrowUpDownIcon, PlusIcon } from 'lucide-react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminHelpArticlesQueryOptions,
  toAdminHelpArticleRows,
} from '../../graphql/admin-help-articles.ts';
import {
  adminHelpCategoriesQueryOptions,
  type HelpCategoryView,
  toHelpCategories,
} from '../../graphql/admin-help-categories.ts';
import {
  buildCreatorOptions,
  type HelpArticleFilter,
  type HelpArticleFilterOption,
} from '../help/help-article-filter.ts';
import { HelpArticleFilters } from '../help/help-article-filters.tsx';
import { HelpArticleTable } from '../help/help-article-table.tsx';
import {
  HELP_ARTICLE_CREATE_LABEL,
  HELP_ARTICLE_ORDER_EDIT_LABEL,
  HELP_ARTICLE_ORDER_VIEW_LABEL,
  HELP_ARTICLES_DESCRIPTION,
  HELP_ARTICLES_TITLE,
} from '../help/help-messages.ts';
import { RoleGate } from '../layout/role-gate.tsx';

const routeApi = getRouteApi('/_authenticated/help-articles/');

const toCategoryOptions = (
  categories: readonly HelpCategoryView[],
): readonly HelpArticleFilterOption[] =>
  categories.map(({ id, name }) => ({ value: id, label: name }));

// 取得に失敗した選択肢の欄は「すべて」だけで操作できるようにし、読み込み中だけを無効にする
const optionsOf = <T,>(
  query: { readonly data: T | undefined; readonly isError: boolean },
  toOptions: (data: T) => readonly HelpArticleFilterOption[],
): readonly HelpArticleFilterOption[] | undefined => {
  if (query.data !== undefined) {
    return toOptions(query.data);
  }
  return query.isError ? [] : undefined;
};

const ORDER_PATH = '/help-articles/order';

export function HelpArticlesPage() {
  const filter = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const articles = useQuery({
    ...adminHelpArticlesQueryOptions(),
    select: toAdminHelpArticleRows,
  });
  const categories = useQuery({
    ...adminHelpCategoriesQueryOptions(),
    select: toHelpCategories,
  });
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = articles.isFetching ? null : articles.error;
  // 絞り込みは取得し直さず画面の中で行うため、条件の変更でスクロールの位置を変えない
  const show = (next: HelpArticleFilter) => {
    void navigate({ search: next, resetScroll: false });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={HELP_ARTICLES_TITLE}
        description={HELP_ARTICLES_DESCRIPTION}
        actions={
          <RoleGate
            minimum="moderator"
            fallback={
              <Button asChild variant="outline">
                <Link to={ORDER_PATH}>
                  <ArrowUpDownIcon aria-hidden="true" />
                  {HELP_ARTICLE_ORDER_VIEW_LABEL}
                </Link>
              </Button>
            }
          >
            <Button asChild variant="outline">
              <Link to={ORDER_PATH}>
                <ArrowUpDownIcon aria-hidden="true" />
                {HELP_ARTICLE_ORDER_EDIT_LABEL}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/help-articles/new">
                <PlusIcon aria-hidden="true" />
                {HELP_ARTICLE_CREATE_LABEL}
              </Link>
            </Button>
          </RoleGate>
        }
      />
      <HelpArticleFilters
        filter={filter}
        creatorOptions={optionsOf(articles, buildCreatorOptions)}
        categoryOptions={optionsOf(categories, toCategoryOptions)}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <HelpArticleTable
        articles={articles.data}
        filter={filter}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void articles.refetch();
                },
              },
            })}
      />
    </div>
  );
}
