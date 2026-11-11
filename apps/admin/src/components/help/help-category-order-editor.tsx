import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDownIcon,
  LoaderCircleIcon,
  ScrollTextIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

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
  adminHelpCategoriesQueryOptions,
  type HelpCategoryView,
  invalidateHelpCategoryQueries,
  toHelpCategories,
} from '../../graphql/admin-help-categories.ts';
import {
  type AdminHelpCategoriesQuery,
  AdminReorderHelpCategoriesDocument,
} from '../../graphql/generated/graphql.ts';
import {
  HELP_CATEGORY_ORDER_CANCEL_LABEL,
  HELP_CATEGORY_ORDER_EDIT_LABEL,
  HELP_CATEGORY_ORDER_LIST_LABEL,
  HELP_ORDER_OUTDATED_MESSAGE,
  HELP_ORDER_RELOAD_LABEL,
  HELP_ORDER_SAVE_LABEL,
  HELP_ORDER_SAVED_MESSAGE,
} from './help-messages.ts';
import { ReorderableList } from './reorderable-list.tsx';

export interface HelpCategoryOrderEditorProps {
  // 管理者が指定した並び順
  readonly categories: readonly HelpCategoryView[];
  // 閲覧のみの管理者には並べ替えの導線を出さない。並びはカテゴリの一覧の表で見える
  readonly readOnly: boolean;
}

interface OrderFailure {
  readonly message: string;
  // 並べ替えを始めた後にカテゴリが増減していた。最新の並びを読み込む導線を出す
  readonly outdated: boolean;
}

type FocusTarget = 'edit-button' | 'order-controls';

const HELP_ORDER_OUTDATED_CODE = 'help_order_outdated';

const isOutdated = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === HELP_ORDER_OUTDATED_CODE;

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

const categoryKey = (category: HelpCategoryView): string => category.id;

const categoryName = (category: HelpCategoryView): string => category.name;

// カテゴリの並べ替え。「並び順を変更」で始めた時点の並びを手元に写して上下の移動で並べ替え、保存で全カテゴリのIDの並びをまとめて送る
export function HelpCategoryOrderEditor({
  categories,
  readOnly,
}: HelpCategoryOrderEditorProps) {
  const queryClient = useQueryClient();
  const reorderCategories = useMutation(
    graphqlMutationOptions(AdminReorderHelpCategoriesDocument),
  );
  // 編集していない間はnull
  const [draft, setDraft] = useState<readonly HelpCategoryView[] | null>(null);
  const [failure, setFailure] = useState<OrderFailure | null>(null);
  const [reloading, setReloading] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const reloadButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<FocusTarget | null>(null);
  const saving = reorderCategories.isPending;

  // 押したボタンが編集の開始・終了や読み込みで消えるため、描き直した後に続きの操作へフォーカスを移す。読み込みの間に利用者が移したフォーカスは奪わない
  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) {
      return;
    }
    pendingFocusRef.current = null;
    if (target === 'edit-button') {
      editButtonRef.current?.focus();
      return;
    }
    controlsRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
  }, [draft]);

  if (readOnly) {
    return null;
  }

  const startEditing = (): void => {
    pendingFocusRef.current = 'order-controls';
    setFailure(null);
    setDraft(categories);
  };

  const finishEditing = (): void => {
    pendingFocusRef.current = 'edit-button';
    setFailure(null);
    setDraft(null);
  };

  const save = async (): Promise<void> => {
    if (draft === null || saving || reloading) {
      return;
    }
    setFailure(null);
    try {
      const { reorderHelpCategories } = await reorderCategories.mutateAsync({
        variables: { orderedIds: draft.map(categoryKey) },
      });
      queryClient.setQueryData<AdminHelpCategoriesQuery>(
        adminHelpCategoriesQueryOptions().queryKey,
        { adminHelpCategories: reorderHelpCategories },
      );
      notify.success(HELP_ORDER_SAVED_MESSAGE);
      finishEditing();
      void invalidateHelpCategoryQueries(queryClient);
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
        ...adminHelpCategoriesQueryOptions(),
        staleTime: 0,
      });
      if (
        reloadButtonRef.current !== null &&
        document.activeElement === reloadButtonRef.current
      ) {
        pendingFocusRef.current = 'order-controls';
      }
      setFailure(null);
      setDraft(toHelpCategories(latest));
    } catch (error) {
      setFailure({ message: failureMessageOf(error), outdated: true });
    } finally {
      setReloading(false);
    }
  };

  if (draft === null) {
    return (
      <div>
        <Button
          ref={editButtonRef}
          type="button"
          variant="outline"
          onClick={startEditing}
        >
          <ArrowUpDownIcon aria-hidden="true" />
          {HELP_CATEGORY_ORDER_EDIT_LABEL}
        </Button>
      </div>
    );
  }

  // 並びは手元に写したIDの順を保ち、名前は同じ画面の表での変更に合わせて最新の一覧から引く。最新の一覧に無いカテゴリは、保存が古い並びとして拒否されるまで写した時点の名前で示す
  const latestById = new Map(
    categories.map((category) => [category.id, category]),
  );
  const shown = draft.map(
    (category) => latestById.get(category.id) ?? category,
  );

  return (
    <div ref={controlsRef} className="flex flex-col gap-4">
      <ReorderableList
        label={HELP_CATEGORY_ORDER_LIST_LABEL}
        items={shown}
        itemKey={categoryKey}
        itemLabel={categoryName}
        renderItem={(category) => (
          <span data-slot="help-category-name" className="font-medium">
            {category.name}
          </span>
        )}
        onChange={setDraft}
        disabled={false}
      />
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
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : null}
              {HELP_ORDER_RELOAD_LABEL}
            </Button>
          ) : null}
        </div>
      )}
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <ScrollTextIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
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
          onClick={() => {
            if (!saving && !reloading) {
              finishEditing();
            }
          }}
        >
          {HELP_CATEGORY_ORDER_CANCEL_LABEL}
        </Button>
      </div>
    </div>
  );
}
