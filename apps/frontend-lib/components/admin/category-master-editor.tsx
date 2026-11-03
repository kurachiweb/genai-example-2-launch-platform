import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';

import {
  CATEGORY_ACTIONS_LABEL,
  CATEGORY_CREATE_LABEL,
  CATEGORY_CREATE_SUBMIT_LABEL,
  CATEGORY_DELETE_DESCRIPTION,
  CATEGORY_DELETE_LABEL,
  CATEGORY_EDIT_LABEL,
  CATEGORY_EMPTY_MESSAGE,
  CATEGORY_HANDLE_LABEL,
  CATEGORY_HANDLE_UNSET_LABEL,
  CATEGORY_NAME_LABEL,
  CATEGORY_READ_ONLY_NOTICE,
  CATEGORY_SYSTEM_DEFAULT_LABEL,
  CATEGORY_SYSTEM_DEFAULT_NOTICE,
  CATEGORY_UPDATE_SUBMIT_LABEL,
  categoryDeleteTitle,
  categoryEditTitle,
  categoryRowActionTarget,
} from '../../utilities/messages/admin-console-messages.ts';
import { Badge } from '../ui/badge/badge.tsx';
import { Button } from '../ui/button/button.tsx';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from './admin-data-table.tsx';
import {
  type CategoryFormValues,
  CategoryFormDialog,
  type CategoryHandleValidator,
} from './category-form-dialog.tsx';
import { ConfirmActionDialog } from './confirm-action-dialog.tsx';

export interface CategoryMasterItem {
  readonly id: string;
  readonly name: string;
  readonly handle?: string;
  readonly systemDefault: boolean;
}

export interface CategoryMasterEditorProps {
  readonly title: string;
  // undefinedは読み込み中。渡した順で並べる
  readonly categories: readonly CategoryMasterItem[] | undefined;
  readonly withHandle: boolean;
  readonly canEdit: boolean;
  readonly validateHandle?: CategoryHandleValidator | undefined;
  readonly onCreate: (input: CategoryFormValues) => Promise<void>;
  readonly onUpdate: (id: string, input: CategoryFormValues) => Promise<void>;
  // 拒否・失敗は例外で知らせ、部品はfailureMessageOfの文言を表示する
  readonly onDelete: (id: string) => Promise<void>;
  readonly failureMessageOf: (error: unknown) => string;
}

interface DialogState {
  readonly open: boolean;
  // 閉じる動きの間も題名を保つため、閉じても対象を残す
  readonly category: CategoryMasterItem | undefined;
  // 閉じる動きの最中に開き直すと前の入力が残るため、開くたびに数を変えて入力欄を作り直す
  readonly session: number;
}

const CLOSED: DialogState = Object.freeze({
  open: false,
  category: undefined,
  session: 0,
});

function RowAction({
  category,
  label,
  icon,
  disabled,
  onPress,
}: {
  readonly category: CategoryMasterItem;
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabled: boolean;
  readonly onPress: (category: CategoryMasterItem) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => {
        onPress(category);
      }}
    >
      {icon}
      {/* 画面に見えない要素と見えている文言を並べると、名前の計算で間に空白が入るため、名前は読み上げだけの要素にまとめて持たせる */}
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{`${categoryRowActionTarget(category.name)}${label}`}</span>
    </Button>
  );
}

export function CategoryMasterEditor({
  title,
  categories,
  withHandle,
  canEdit,
  validateHandle,
  onCreate,
  onUpdate,
  onDelete,
  failureMessageOf,
}: CategoryMasterEditorProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 削除に成功すると開いた元の行が消えるため、成功した時だけ見出しを戻り先にし、取り消しでは開いた元の行へ戻す
  const deletedReturnFocusRef = useRef<HTMLElement | null>(null);
  const [form, setForm] = useState<DialogState>(CLOSED);
  const [deletion, setDeletion] = useState<DialogState>(CLOSED);
  const editing = form.category;
  const deleting = deletion.category;
  const hasSystemDefault =
    categories?.some((category) => category.systemDefault) ?? false;

  const openForm = (category: CategoryMasterItem | undefined): void => {
    setForm((current) => ({
      open: true,
      category,
      session: current.session + 1,
    }));
  };

  const openDeletion = (category: CategoryMasterItem): void => {
    deletedReturnFocusRef.current = null;
    setDeletion((current) => ({
      open: true,
      category,
      session: current.session + 1,
    }));
  };

  const confirmDeletion = async (): Promise<void> => {
    if (deleting === undefined) {
      return;
    }
    await onDelete(deleting.id);
    deletedReturnFocusRef.current = headingRef.current;
  };

  const columns: readonly AdminDataTableColumn<CategoryMasterItem>[] = [
    {
      key: 'name',
      header: CATEGORY_NAME_LABEL,
      cell: (category) => (
        <span className="flex flex-wrap items-center gap-2">
          {category.name}
          {category.systemDefault ? (
            <Badge variant="secondary">{CATEGORY_SYSTEM_DEFAULT_LABEL}</Badge>
          ) : null}
        </span>
      ),
    },
    ...(withHandle
      ? [
          {
            key: 'handle',
            header: CATEGORY_HANDLE_LABEL,
            cell: (category: CategoryMasterItem) =>
              category.handle === undefined ? (
                <span className="text-muted-foreground">
                  {CATEGORY_HANDLE_UNSET_LABEL}
                </span>
              ) : (
                <span translate="no">{category.handle}</span>
              ),
          },
        ]
      : []),
    {
      key: 'actions',
      header: CATEGORY_ACTIONS_LABEL,
      className: 'text-end',
      cell: (category) => (
        <span className="flex flex-wrap justify-end gap-2">
          <RowAction
            category={category}
            label={CATEGORY_EDIT_LABEL}
            icon={<PencilIcon aria-hidden="true" />}
            disabled={!canEdit}
            onPress={openForm}
          />
          {category.systemDefault ? null : (
            <RowAction
              category={category}
              label={CATEGORY_DELETE_LABEL}
              icon={<Trash2Icon aria-hidden="true" />}
              disabled={!canEdit}
              onPress={openDeletion}
            />
          )}
        </span>
      ),
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 削除で開いた元の行が消えた後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-lg font-semibold"
        >
          {title}
        </h2>
        <Button
          type="button"
          disabled={!canEdit}
          onClick={() => {
            openForm(undefined);
          }}
        >
          <PlusIcon aria-hidden="true" />
          {CATEGORY_CREATE_LABEL}
        </Button>
      </div>
      {canEdit ? null : (
        <p className="text-sm text-muted-foreground">
          {CATEGORY_READ_ONLY_NOTICE}
        </p>
      )}
      {hasSystemDefault ? (
        <p className="text-sm text-muted-foreground">
          {CATEGORY_SYSTEM_DEFAULT_NOTICE}
        </p>
      ) : null}
      <AdminDataTable
        caption={title}
        columns={columns}
        rows={categories}
        rowKey={(category) => category.id}
        emptyMessage={CATEGORY_EMPTY_MESSAGE}
      />
      <CategoryFormDialog
        key={form.session}
        open={form.open}
        onOpenChange={(open) => {
          setForm((current) => ({ ...current, open }));
        }}
        title={
          editing === undefined
            ? CATEGORY_CREATE_LABEL
            : categoryEditTitle(editing.name)
        }
        submitLabel={
          editing === undefined
            ? CATEGORY_CREATE_SUBMIT_LABEL
            : CATEGORY_UPDATE_SUBMIT_LABEL
        }
        initialValues={editing}
        withHandle={withHandle}
        validateHandle={validateHandle}
        onSubmit={(values) =>
          editing === undefined
            ? onCreate(values)
            : onUpdate(editing.id, values)
        }
        failureMessageOf={failureMessageOf}
      />
      <ConfirmActionDialog
        key={deletion.session}
        open={deletion.open}
        onOpenChange={(open) => {
          setDeletion((current) => ({ ...current, open }));
        }}
        title={categoryDeleteTitle(deleting?.name ?? '')}
        description={CATEGORY_DELETE_DESCRIPTION}
        confirmLabel={CATEGORY_DELETE_LABEL}
        reason="none"
        audited={false}
        onConfirm={confirmDeletion}
        failureMessageOf={failureMessageOf}
        returnFocusRef={deletedReturnFocusRef}
      />
    </section>
  );
}
