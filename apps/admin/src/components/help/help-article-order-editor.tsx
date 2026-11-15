import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon, ScrollTextIcon } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';

import type { PinnedHelpGroups } from '../../../common-lib/help/help-ordering.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { AUDITED_ACTION_NOTICE } from '../../../lib/utilities/messages/admin-console-messages.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  type AdminHelpArticleRowView,
  adminHelpArticlesQueryOptions,
  invalidateHelpArticleQueries,
  mergeReorderedHelpArticles,
  toAdminHelpArticleRows,
  toHelpArticleOrderGroups,
} from '../../graphql/admin-help-articles.ts';
import {
  type AdminHelpArticlesQuery,
  AdminReorderHelpArticlesDocument,
} from '../../graphql/generated/graphql.ts';
import { HelpArticleStatusBadge } from './help-article-status-badge.tsx';
import {
  HELP_ARTICLE_ORDER_EMPTY_MESSAGE,
  HELP_ORDER_OUTDATED_MESSAGE,
  HELP_ORDER_RELOAD_LABEL,
  HELP_ORDER_SAVE_LABEL,
  HELP_ORDER_SAVED_MESSAGE,
  HELP_ORDER_UNDO_LABEL,
  HELP_OTHER_ARTICLES_LABEL,
  HELP_PINNED_ARTICLES_LABEL,
} from './help-messages.ts';
import { ReorderableList } from './reorderable-list.tsx';

export interface HelpArticleOrderEditorProps {
  readonly categoryId: string;
  // 全カテゴリの記事。選んだカテゴリの記事だけを並べる
  readonly articles: readonly AdminHelpArticleRowView[];
  // 閲覧のみの管理者には並びだけを見せ、移動・保存・元に戻すを描かない
  readonly readOnly: boolean;
}

type ArticleGroups = PinnedHelpGroups<AdminHelpArticleRowView>;

type GroupKey = keyof ArticleGroups;

interface OrderFailure {
  readonly message: string;
  // 並びを表示した後にカテゴリの記事が増減・移動していた。最新の並びを読み込む導線を出す
  readonly outdated: boolean;
}

const GROUP_LABELS: Readonly<Record<GroupKey, string>> = Object.freeze({
  pinned: HELP_PINNED_ARTICLES_LABEL,
  others: HELP_OTHER_ARTICLES_LABEL,
});

const GROUP_KEYS: readonly GroupKey[] = ['pinned', 'others'];

const HELP_ORDER_OUTDATED_CODE = 'help_order_outdated';

const isOutdated = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === HELP_ORDER_OUTDATED_CODE;

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

const articleKey = (article: AdminHelpArticleRowView): string => article.id;

const articleTitle = (article: AdminHelpArticleRowView): string =>
  article.title;

const renderArticle = (article: AdminHelpArticleRowView) => (
  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
    <span data-slot="help-article-title" className="font-medium wrap-anywhere">
      {article.title}
    </span>
    <HelpArticleStatusBadge status={article.status} />
  </span>
);

function ArticleGroup({
  label,
  articles,
  readOnly,
  onChange,
}: {
  readonly label: string;
  readonly articles: readonly AdminHelpArticleRowView[];
  readonly readOnly: boolean;
  readonly onChange: (articles: readonly AdminHelpArticleRowView[]) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-bold">
        {label}
      </h2>
      {articles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {HELP_ARTICLE_ORDER_EMPTY_MESSAGE}
        </p>
      ) : (
        <ReorderableList
          label={label}
          items={articles}
          itemKey={articleKey}
          itemLabel={articleTitle}
          renderItem={renderArticle}
          onChange={onChange}
          disabled={readOnly}
        />
      )}
    </section>
  );
}

// 選んだカテゴリの記事の並べ替え。上下の移動で手元の並びを変え、保存でピン留めの群に続けてその他の群のIDの並びをまとめて送る
export function HelpArticleOrderEditor({
  categoryId,
  articles,
  readOnly,
}: HelpArticleOrderEditorProps) {
  const queryClient = useQueryClient();
  const reorderArticles = useMutation(
    graphqlMutationOptions(AdminReorderHelpArticlesDocument),
  );
  // nullの間は最新の並び順を示す。保存と読み込みの後は応答から作った並びを置き、キャッシュの更新が取得の結果として届くまでの間に古い並びを示さない
  const [draft, setDraft] = useState<ArticleGroups | null>(null);
  const [failure, setFailure] = useState<OrderFailure | null>(null);
  const [reloading, setReloading] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const reloadButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef(false);
  const saving = reorderArticles.isPending;

  // 押した「最新の並びを読み込む」は読み込みの後に消えるため、描き直した後に最初の押せる移動のボタンへフォーカスを移す。読み込みの間に利用者が移したフォーカスは奪わない
  useLayoutEffect(() => {
    if (!pendingFocusRef.current) {
      return;
    }
    pendingFocusRef.current = false;
    controlsRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
  });

  const current = toHelpArticleOrderGroups(articles, categoryId);
  // 並びは手元に写したIDの順を保ち、タイトルとステータスは最新の一覧から引く。最新の一覧に無い記事は、保存が古い並びとして拒否されるまで写した時点の内容で示す
  const latestById = new Map(articles.map((article) => [article.id, article]));
  const shown: ArticleGroups =
    draft === null
      ? current
      : {
          pinned: draft.pinned.map((row) => latestById.get(row.id) ?? row),
          others: draft.others.map((row) => latestById.get(row.id) ?? row),
        };

  const changeGroup =
    (key: GroupKey) => (moved: readonly AdminHelpArticleRowView[]) => {
      setDraft({ ...shown, [key]: moved });
    };

  const save = async (): Promise<void> => {
    if (saving || reloading) {
      return;
    }
    setFailure(null);
    try {
      const { reorderHelpArticles } = await reorderArticles.mutateAsync({
        variables: {
          categoryId,
          orderedIds: [...shown.pinned, ...shown.others].map(articleKey),
        },
      });
      queryClient.setQueryData<AdminHelpArticlesQuery>(
        adminHelpArticlesQueryOptions().queryKey,
        (data) =>
          data === undefined
            ? data
            : mergeReorderedHelpArticles(data, reorderHelpArticles),
      );
      setDraft(
        toHelpArticleOrderGroups(
          toAdminHelpArticleRows({ adminHelpArticles: reorderHelpArticles }),
          categoryId,
        ),
      );
      notify.success(HELP_ORDER_SAVED_MESSAGE);
      void invalidateHelpArticleQueries(queryClient);
    } catch (error) {
      setFailure(
        isOutdated(error)
          ? { message: HELP_ORDER_OUTDATED_MESSAGE, outdated: true }
          : { message: failureMessageOf(error), outdated: false },
      );
    }
  };

  const reload = async (): Promise<void> => {
    if (reloading || saving) {
      return;
    }
    setReloading(true);
    try {
      const latest = await queryClient.query({
        ...adminHelpArticlesQueryOptions(),
        staleTime: 0,
      });
      pendingFocusRef.current =
        reloadButtonRef.current !== null &&
        document.activeElement === reloadButtonRef.current;
      setFailure(null);
      setDraft(
        toHelpArticleOrderGroups(toAdminHelpArticleRows(latest), categoryId),
      );
    } catch (error) {
      setFailure({ message: failureMessageOf(error), outdated: true });
    } finally {
      setReloading(false);
    }
  };

  const undo = (): void => {
    if (saving || reloading) {
      return;
    }
    setFailure(null);
    setDraft(null);
  };

  return (
    <div ref={controlsRef} className="flex flex-col gap-6">
      {GROUP_KEYS.map((key) => (
        <ArticleGroup
          key={key}
          label={GROUP_LABELS[key]}
          articles={shown[key]}
          readOnly={readOnly}
          onChange={changeGroup(key)}
        />
      ))}
      {readOnly ? null : (
        <div className="flex flex-col gap-4">
          {failure === null ? null : (
            <div className="flex flex-col items-start gap-2">
              <FormMessage role="alert">{failure.message}</FormMessage>
              {failure.outdated ? (
                <Button
                  ref={reloadButtonRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-busy={reloading ? true : undefined}
                  aria-disabled={reloading ? true : undefined}
                  onClick={() => {
                    void reload();
                  }}
                >
                  {reloading ? (
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="animate-spin"
                    />
                  ) : null}
                  {HELP_ORDER_RELOAD_LABEL}
                </Button>
              ) : null}
            </div>
          )}
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <ScrollTextIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>{AUDITED_ACTION_NOTICE}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              aria-busy={saving ? true : undefined}
              aria-disabled={saving || reloading ? true : undefined}
              onClick={() => {
                void save();
              }}
            >
              {saving ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : null}
              {HELP_ORDER_SAVE_LABEL}
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-disabled={saving || reloading ? true : undefined}
              onClick={undo}
            >
              {HELP_ORDER_UNDO_LABEL}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
