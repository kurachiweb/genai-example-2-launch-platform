import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { AdminModerationProductView } from '../../../graphql/admin-moderation-products.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { ModerationActionDialog } from '../shared/moderation-action-dialog.tsx';
import {
  hideProductDialogCopy,
  type ModerationDialogCopy,
  PRODUCT_ACTION_LABELS,
  unhideProductDialogCopy,
} from '../shared/moderation-messages.ts';
import type { ModerationOperation } from '../shared/moderation-operations.ts';

export interface ProductVisibilityActionsProps {
  readonly product: Pick<
    AdminModerationProductView,
    'id' | 'name' | 'visibility'
  >;
}

type ProductActionKind = keyof typeof PRODUCT_ACTION_LABELS;

const OPERATION_OF = Object.freeze({
  hide: 'product.hide',
  unhide: 'product.unhide',
} as const satisfies Record<ProductActionKind, ModerationOperation>);

const DIALOG_COPY_OF = Object.freeze({
  hide: hideProductDialogCopy,
  unhide: unhideProductDialogCopy,
} satisfies Record<ProductActionKind, (name: string) => ModerationDialogCopy>);

// 非公開化中のプロダクトに復元、それ以外(投稿者が停止中を含む)に非公開化を示す。どちらも理由を必須とし、モデレーター以上にだけ示す
export function ProductVisibilityActions({
  product,
}: ProductVisibilityActionsProps) {
  const kind: ProductActionKind =
    product.visibility === 'hidden' ? 'unhide' : 'hide';
  const [open, setOpen] = useState(false);
  // 確定の後に取り直した状態で操作が替わっても、閉じる間は開いた時の確認を示し続ける
  const [openedKind, setOpenedKind] = useState<ProductActionKind>(kind);
  const copy = DIALOG_COPY_OF[openedKind](product.name);
  const Icon = kind === 'hide' ? EyeOffIcon : EyeIcon;

  return (
    <RoleGate minimum="moderator">
      <Button
        type="button"
        variant={kind === 'hide' ? 'destructive' : 'outline'}
        size="sm"
        onClick={() => {
          setOpenedKind(kind);
          setOpen(true);
        }}
      >
        <Icon aria-hidden="true" />
        {PRODUCT_ACTION_LABELS[kind]}
      </Button>
      <ModerationActionDialog
        open={open}
        onOpenChange={setOpen}
        operation={OPERATION_OF[openedKind]}
        targetId={product.id}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
      />
    </RoleGate>
  );
}
