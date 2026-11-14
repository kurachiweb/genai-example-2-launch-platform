import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useId, useRef } from 'react';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminHelpArticlesQueryOptions,
  toAdminHelpArticleRows,
} from '../../graphql/admin-help-articles.ts';
import {
  adminHelpCategoriesQueryOptions,
  toHelpCategories,
} from '../../graphql/admin-help-categories.ts';
import { HelpArticleOrderEditor } from '../help/help-article-order-editor.tsx';
import { selectHelpOrderCategory } from '../help/help-article-order-search.ts';
import {
  HELP_ARTICLE_ORDER_CATEGORY_LABEL,
  HELP_ARTICLE_ORDER_DESCRIPTION,
  HELP_ARTICLE_ORDER_TITLE,
} from '../help/help-messages.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';

const routeApi = getRouteApi('/_authenticated/help-articles/order');

export function HelpArticleOrderPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const readOnly = !hasRole(useAdminRole(), 'moderator');
  const selectId = useId();
  const pageRef = useRef<HTMLDivElement>(null);
  const articles = useQuery({
    ...adminHelpArticlesQueryOptions(),
    select: toAdminHelpArticleRows,
  });
  const categories = useQuery({
    ...adminHelpCategoriesQueryOptions(),
    select: toHelpCategories,
  });
  const category =
    categories.data === undefined
      ? undefined
      : selectHelpOrderCategory(categories.data, search.category);
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const failure =
    (articles.isFetching ? null : articles.error) ??
    (categories.isFetching ? null : categories.error);

  const retry = (): void => {
    // 押した再試行のボタンは消えるため、フォーカスを<body>へ落とさないよう題名へ移す
    const title = pageRef.current?.querySelector<HTMLElement>('h1');
    title?.setAttribute('tabindex', '-1');
    title?.focus();
    if (articles.isError) {
      void articles.refetch();
    }
    if (categories.isError) {
      void categories.refetch();
    }
  };

  const renderOrder = () => {
    if (failure !== null) {
      return (
        <ErrorState
          message={errorMessageOf(failure, ADMIN_PROFILE.contactAvailable)}
          onRetry={retry}
        />
      );
    }
    if (articles.data === undefined || categories.data === undefined) {
      return <LoadingSkeleton />;
    }
    if (category === undefined) {
      return null;
    }
    // カテゴリを切り替えると、保存していない並びは破棄して選んだカテゴリの現在の並び順から始める
    return (
      <HelpArticleOrderEditor
        key={category.id}
        categoryId={category.id}
        articles={articles.data}
        readOnly={readOnly}
      />
    );
  };

  return (
    <div
      ref={pageRef}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8"
    >
      <AdminPageHeader
        title={HELP_ARTICLE_ORDER_TITLE}
        description={HELP_ARTICLE_ORDER_DESCRIPTION}
      />
      <div className="flex max-w-xs flex-col gap-2">
        <Label htmlFor={selectId}>{HELP_ARTICLE_ORDER_CATEGORY_LABEL}</Label>
        <Select
          value={category?.id ?? ''}
          disabled={categories.data === undefined}
          onValueChange={(next) => {
            // カテゴリの選択は表示する並びの条件のため、履歴に加えて戻る操作で前のカテゴリへ戻れるようにし、選択欄の位置に留める
            void navigate({ search: { category: next }, resetScroll: false });
          }}
        >
          <SelectTrigger id={selectId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(categories.data ?? []).map(({ id, name }) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {renderOrder()}
    </div>
  );
}
