import { FlagIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { ProductPageContext } from '../product-page/product-page-section-types.ts';
import { ReportDialog } from './report-dialog.tsx';
import { REPORT_ACTION_LABELS } from './report-messages.ts';

// ページを移動せずにダイアログを開く操作のため、見た目は控えめなリンクでも`button`要素にする
export function ProductReportLink({ product, viewer }: ProductPageContext) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (viewer.isOwner) {
    return null;
  }
  return (
    <div className="flex justify-end border-t border-border pt-4">
      <Button
        ref={buttonRef}
        type="button"
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => {
          setOpen(true);
        }}
      >
        <FlagIcon aria-hidden="true" />
        {REPORT_ACTION_LABELS.product}
      </Button>
      <ReportDialog
        targetKind="product"
        targetRef={product.id}
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={buttonRef}
      />
    </div>
  );
}
