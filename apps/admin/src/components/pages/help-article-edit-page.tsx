import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ExternalLinkIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  adminHelpArticleQueryOptions,
  type AdminHelpArticleView,
  invalidateHelpArticleQueries,
  toAdminHelpArticleDetail,
} from '../../graphql/admin-help-articles.ts';
import {
  adminHelpCategoriesQueryOptions,
  type HelpCategoryView,
  toHelpCategories,
} from '../../graphql/admin-help-categories.ts';
import { HelpArticleDeleteButton } from '../help/help-article-delete-button.tsx';
import { HelpArticleForm } from '../help/help-article-form.tsx';
import {
  HELP_ARTICLE_FORM_EDIT_LABEL,
  HELP_ARTICLE_HANDLE_PREFIX,
  HELP_ARTICLE_NOT_FOUND_MESSAGE,
  HELP_ARTICLE_OPEN_PUBLIC_LABEL,
  HELP_ARTICLE_SAVED_MESSAGE,
  HELP_ARTICLES_LINK_LABEL,
  NEW_TAB_NOTICE,
} from '../help/help-messages.ts';
import { RoleGate } from '../layout/role-gate.tsx';
import { useClientSiteHref } from '../layout/use-client-site-href.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';

const routeApi = getRouteApi('/_authenticated/help-articles/$articleId');

const PAGE_CLASS_NAME =
  'mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8';

function PublicPageLink({ handle }: { readonly handle: string }) {
  const clientSiteHref = useClientSiteHref();
  return (
    <Button asChild variant="outline">
      <a
        href={clientSiteHref(
          `${HELP_ARTICLE_HANDLE_PREFIX}${encodeURIComponent(handle)}`,
        )}
        target="_blank"
        rel="noopener"
      >
        <ExternalLinkIcon aria-hidden="true" />
        {HELP_ARTICLE_OPEN_PUBLIC_LABEL}
        <span className="sr-only">{NEW_TAB_NOTICE}</span>
      </a>
    </Button>
  );
}

interface HelpArticleEditorProps {
  readonly loaded: AdminHelpArticleView;
  readonly categories: readonly HelpCategoryView[];
}

// 保存の後は応答の記事を画面の内容にし、取得し直した記事では差し替えない。編集中のフォームの値と送る版が、他の画面の変更とすり替わらないようにするため
function HelpArticleEditor({ loaded, categories }: HelpArticleEditorProps) {
  const queryClient = useQueryClient();
  const readOnly = !hasRole(useAdminRole(), 'moderator');
  const [article, setArticle] = useState(loaded);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(false);

  // 保存の結果でフォームを作り直すと押した保存のボタンが消え、新しい保存のボタンは検証を終えるまで無効のため、フォーカスが<body>へ落ちた時は題名へ移す
  useLayoutEffect(() => {
    if (!savedRef.current) {
      return;
    }
    savedRef.current = false;
    if (
      document.activeElement === null ||
      document.activeElement === document.body
    ) {
      const title = editorRef.current?.querySelector<HTMLElement>('h1');
      title?.setAttribute('tabindex', '-1');
      title?.focus();
    }
  }, [article]);

  return (
    <div ref={editorRef} className="flex flex-col gap-6">
      <AdminPageHeader
        title={HELP_ARTICLE_FORM_EDIT_LABEL}
        actions={
          <>
            {article.status === 'published' ? (
              <PublicPageLink handle={article.handle} />
            ) : null}
            <RoleGate minimum="moderator">
              <HelpArticleDeleteButton article={article} />
            </RoleGate>
          </>
        }
      />
      {/* 保存した版ごとにフォームを作り直し、入力欄・理由を保存の結果から始め直す */}
      <HelpArticleForm
        key={article.revision}
        mode="edit"
        article={article}
        categories={categories}
        readOnly={readOnly}
        onSaved={(saved) => {
          savedRef.current = true;
          setArticle(saved);
          notify.success(HELP_ARTICLE_SAVED_MESSAGE);
          void invalidateHelpArticleQueries(queryClient);
        }}
      />
    </div>
  );
}

export function HelpArticleEditPage() {
  const { articleId } = routeApi.useParams();
  // 表示する前にloaderが毎回新しく取得しているため、表示した時点と再接続では取り直さない
  const { data: loaded } = useSuspenseQuery({
    ...adminHelpArticleQueryOptions(articleId),
    select: toAdminHelpArticleDetail,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  const { data: categories } = useSuspenseQuery({
    ...adminHelpCategoriesQueryOptions(),
    select: toHelpCategories,
  });

  return (
    <div className={PAGE_CLASS_NAME}>
      {loaded === null ? (
        <>
          <AdminPageHeader title={HELP_ARTICLE_FORM_EDIT_LABEL} />
          <EmptyState
            title={HELP_ARTICLE_NOT_FOUND_MESSAGE}
            action={
              <Button asChild variant="outline">
                <Link to="/help-articles">{HELP_ARTICLES_LINK_LABEL}</Link>
              </Button>
            }
          />
        </>
      ) : (
        <HelpArticleEditor
          key={loaded.id}
          loaded={loaded}
          categories={categories}
        />
      )}
    </div>
  );
}
