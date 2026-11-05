import { useMemo, useRef, useState } from 'react';

import {
  CATEGORY_NAME_MESSAGES,
  checkCategoryName,
} from '../../../common-lib/admin/admin-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import {
  CATEGORY_HANDLE_LABEL,
  CONFIRM_ACTION_CANCEL_LABEL,
  REQUIRED_CATEGORY_NAME_LABEL,
} from '../../utilities/messages/admin-console-messages.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { FormMessage } from '../form/form-message.tsx';
import { SubmitButton } from '../form/submit-button.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import { Button } from '../ui/button/button.tsx';
import { Dialog } from '../ui/dialog/dialog.tsx';
import { DialogContent } from '../ui/dialog/dialog-content.tsx';
import { DialogFooter } from '../ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../ui/dialog/dialog-title.tsx';
import { Input } from '../ui/input/input.tsx';

export interface CategoryFormValues {
  readonly name: string;
  readonly handle?: string;
}

// 妥当ならundefined、違反なら欄に示す文言を返す
export type CategoryHandleValidator = (handle: string) => string | undefined;

export interface CategoryFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly submitLabel: string;
  // 追加はundefinedで、空の入力欄から始める
  readonly initialValues: CategoryFormValues | undefined;
  readonly withHandle: boolean;
  readonly validateHandle?: CategoryHandleValidator | undefined;
  // 拒否・失敗は例外で知らせる
  readonly onSubmit: (values: CategoryFormValues) => Promise<void>;
  readonly failureMessageOf: (error: unknown) => string;
}

interface CategoryFormInput {
  name: string;
  handle: string;
}

interface CategoryFormOutput {
  readonly name: string;
  readonly handle?: string | undefined;
}

const categoryNameSchema = (): z.ZodType<string, string> =>
  z
    .string()
    .superRefine((value, context) => {
      const check = checkCategoryName(value);
      if (check !== undefined) {
        context.addIssue({
          code: 'custom',
          message: CATEGORY_NAME_MESSAGES[check],
        });
      }
    })
    .transform(trimWhiteSpace);

const categoryHandleSchema = (
  validateHandle: CategoryHandleValidator | undefined,
): z.ZodType<string | undefined, string> =>
  z
    .string()
    .transform(trimWhiteSpace)
    .superRefine((value, context) => {
      const message = validateHandle?.(value);
      if (message !== undefined) {
        context.addIssue({ code: 'custom', message });
      }
    })
    .transform((value) => (value === '' ? undefined : value));

const categoryFormSchema = (
  withHandle: boolean,
  validateHandle: CategoryHandleValidator | undefined,
): z.ZodType<CategoryFormOutput, CategoryFormInput> =>
  withHandle
    ? z.object({
        name: categoryNameSchema(),
        handle: categoryHandleSchema(validateHandle),
      })
    : z
        .object({ name: categoryNameSchema(), handle: z.string() })
        .transform(({ name }) => ({ name }));

const valuesOf = ({ name, handle }: CategoryFormOutput): CategoryFormValues =>
  handle === undefined ? { name } : { name, handle };

interface CategoryFormProps {
  readonly initialValues: CategoryFormValues | undefined;
  readonly withHandle: boolean;
  readonly validateHandle: CategoryHandleValidator | undefined;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly onSubmit: (values: CategoryFormValues) => Promise<void>;
  readonly failureMessageOf: (error: unknown) => string;
  readonly onCancel: () => void;
}

// ダイアログを閉じると中身が取り除かれるため、開くたびに入力と失敗の表示を始め直す
function CategoryForm({
  initialValues,
  withHandle,
  validateHandle,
  submitLabel,
  pending,
  onSubmit,
  failureMessageOf,
  onCancel,
}: CategoryFormProps) {
  const schema = useMemo(
    () => categoryFormSchema(withHandle, validateHandle),
    [withHandle, validateHandle],
  );
  const form = useAppForm(schema, {
    defaultValues: {
      name: initialValues?.name ?? '',
      handle: initialValues?.handle ?? '',
    },
  });
  const [failure, setFailure] = useState<string>();

  return (
    <AppForm
      form={form}
      onSubmit={async (values) => {
        setFailure(undefined);
        await onSubmit(valuesOf(values));
      }}
      onSubmitError={(error) => {
        setFailure(failureMessageOf(error));
      }}
      className="flex flex-col gap-4"
    >
      {failure === undefined ? null : (
        <FormMessage role="alert">{failure}</FormMessage>
      )}
      <FormField
        control={form.control}
        name="name"
        label={REQUIRED_CATEGORY_NAME_LABEL}
      >
        {(control) => (
          <Input {...control} autoComplete="off" aria-required="true" />
        )}
      </FormField>
      {withHandle ? (
        <FormField
          control={form.control}
          name="handle"
          label={CATEGORY_HANDLE_LABEL}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              translate="no"
            />
          )}
        </FormField>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending ? true : undefined}
          onClick={onCancel}
        >
          {CONFIRM_ACTION_CANCEL_LABEL}
        </Button>
        <SubmitButton>{submitLabel}</SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialValues,
  withHandle,
  validateHandle,
  onSubmit,
  failureMessageOf,
}: CategoryFormDialogProps) {
  const [pending, setPending] = useState(false);
  // 処理中の状態は再描画の後に効くため、同じ描画の間に届いた閉じる操作もここで止める
  const pendingRef = useRef(false);
  const openerRef = useRef<Element | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 保存の途中で閉じると、失敗の文言を示す場所が無くなるため、処理中は閉じない
  const requestClose = (): void => {
    if (!pendingRef.current) {
      onOpenChange(false);
    }
  };

  const submit = async (values: CategoryFormValues): Promise<void> => {
    pendingRef.current = true;
    setPending(true);
    try {
      await onSubmit(values);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      // 開く元の要素を持たず状態で開くため、部品から届くのは閉じる要求だけ
      onOpenChange={(next) => {
        if (!next) {
          requestClose();
        }
      }}
    >
      <DialogContent
        ref={contentRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby={undefined}
        closeButtonDisabled={pending}
        onBlur={(event) => {
          // 処理中に受け付けなかったダイアログの外の押下は、フォーカスを<body>へ落として戻さないため、ダイアログへ戻す。ウィンドウの切り替えではフォーカスのある要素が変わらないため何もしない
          if (
            pendingRef.current &&
            event.relatedTarget === null &&
            document.activeElement === document.body
          ) {
            contentRef.current?.focus();
          }
        }}
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = openerRef.current;
          if (opener instanceof HTMLElement && opener.isConnected) {
            opener.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <CategoryForm
          initialValues={initialValues}
          withHandle={withHandle}
          validateHandle={validateHandle}
          submitLabel={submitLabel}
          pending={pending}
          onSubmit={submit}
          failureMessageOf={failureMessageOf}
          onCancel={requestClose}
        />
      </DialogContent>
    </Dialog>
  );
}
