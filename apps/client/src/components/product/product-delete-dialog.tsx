import { type MouseEvent, useId, useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { DialogTrigger } from '../../../lib/components/ui/dialog/dialog-trigger.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { PRODUCT_BOT_ACTIONS } from './bot-actions.ts';
import {
  DELETE_CANCEL_LABEL,
  DELETE_CONFIRM_DESCRIPTION,
  DELETE_CONFIRM_LABEL,
  DELETE_PRODUCT_LABEL,
  deleteConfirmTitleOf,
} from './product-edit-messages.ts';
import type { ProductDeleteNotice } from './product-section-types.ts';
import { useProductDeletion } from './use-product-deletion.ts';

export interface ProductDeleteDialogProps {
  readonly productName: string;
  readonly productHandle: string;
  // 編集画面が表示中に取り直した最新の版
  readonly expectedVersion: number;
  // orderの順に並べ替え済みの登録
  readonly notices: readonly ProductDeleteNotice[];
  // 固定の期間など、削除を受け付けない理由。渡すとボタンを無効にし、理由をボタンに結び付けて示す
  readonly lockReason?: string;
  // 真なら理由を示さずにボタンを無効にする(停止中の利用者は画面の上部に理由を示す)
  readonly disabled: boolean;
}

// 確認の操作には入力欄が無いため、空の値を送信の状態の管理だけに使う
const CONFIRM_SCHEMA = z.object({});

const EMPTY_VALUES = Object.freeze({});

interface DeleteConfirmFormProps {
  readonly productHandle: string;
  readonly expectedVersion: number;
  readonly label: string;
}

function DeleteConfirmForm({
  productHandle,
  expectedVersion,
  label,
}: DeleteConfirmFormProps) {
  const form = useAppForm(CONFIRM_SCHEMA, { defaultValues: EMPTY_VALUES });
  const turnstile = useTurnstileToken();
  const deleteProduct = useProductDeletion({ productHandle, expectedVersion });
  const [submitError, setSubmitError] = useState<string>();

  return (
    <AppForm
      form={form}
      aria-label={label}
      onSubmit={async () => {
        setSubmitError(undefined);
        await deleteProduct(turnstile);
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-4"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={PRODUCT_BOT_ACTIONS.delete}
      />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {DELETE_CANCEL_LABEL}
          </Button>
        </DialogClose>
        <SubmitButton variant="destructive">
          {DELETE_CONFIRM_LABEL}
        </SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}

// 後続の機能の注意書きは個別のエラーの境界で包み、1つの失敗が確認と他の注意書きを止めないようにする
function DeleteNotices({
  notices,
  productHandle,
}: Pick<ProductDeleteDialogProps, 'notices' | 'productHandle'>) {
  if (notices.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      {notices.map(({ id, component: Notice }) => (
        <RecoverableSlot
          key={id}
          className="rounded-xl"
          contactAvailable={CLIENT_PROFILE.contactAvailable}
          contactHref={CONTACT_HREF}
        >
          <Notice productHandle={productHandle} />
        </RecoverableSlot>
      ))}
    </div>
  );
}

// 表示中の取り直しで固定の期間に入った時は、フォーカスのあるボタンを無効にするとフォーカスを失うため、フォーカスが離れるまでaria-disabledにして押下を無視し、離れてから無効にする
export function ProductDeleteDialog({
  productName,
  productHandle,
  expectedVersion,
  notices,
  lockReason,
  disabled,
}: ProductDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [buttonFocused, setButtonFocused] = useState(false);
  const reasonId = useId();
  const blocked = disabled || lockReason !== undefined;
  const title = deleteConfirmTitleOf(productName);

  return (
    <div className="flex flex-col items-start gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            disabled={blocked && !buttonFocused}
            aria-disabled={blocked && buttonFocused ? true : undefined}
            aria-describedby={lockReason === undefined ? undefined : reasonId}
            onFocus={() => {
              setButtonFocused(true);
            }}
            onBlur={() => {
              setButtonFocused(false);
            }}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              if (blocked) {
                event.preventDefault();
              }
            }}
          >
            {DELETE_PRODUCT_LABEL}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{DELETE_CONFIRM_DESCRIPTION}</DialogDescription>
          </DialogHeader>
          <DeleteNotices notices={notices} productHandle={productHandle} />
          <DeleteConfirmForm
            productHandle={productHandle}
            expectedVersion={expectedVersion}
            label={title}
          />
        </DialogContent>
      </Dialog>
      {lockReason === undefined ? null : (
        <p id={reasonId} className="text-sm text-muted-foreground">
          {lockReason}
        </p>
      )}
    </div>
  );
}
