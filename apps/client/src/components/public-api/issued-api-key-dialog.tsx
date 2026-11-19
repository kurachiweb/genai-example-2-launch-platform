import { CopyIcon } from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Dialog } from '../../../lib/components/ui/dialog/dialog.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogContent } from '../../../lib/components/ui/dialog/dialog-content.tsx';
import { DialogDescription } from '../../../lib/components/ui/dialog/dialog-description.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../../../lib/components/ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../../../lib/components/ui/dialog/dialog-title.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { writeToClipboard } from '../../../lib/utilities/clipboard/write-to-clipboard.ts';
import { ISSUED_API_KEY_MESSAGES } from './api-key-dialog-messages.ts';

export interface IssuedApiKeyDialogProps {
  // 発行・再発行の応答の平文。nullの間は閉じている
  readonly plainKey: string | null;
  // 呼び出し側は平文を破棄してnullを渡す
  readonly onClose: () => void;
  // 閉じた後にフォーカスを戻す、開いた元の操作
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

interface IssuedApiKeyBodyProps {
  readonly plainKey: string | null;
}

// 閉じる動きの間は親から平文が届かないため、ダイアログの中身の状態に最後の平文を持たせ、閉じ終えて中身が取り除かれると状態ごと破棄させる
function IssuedApiKeyBody({ plainKey }: IssuedApiKeyBodyProps) {
  const inputId = useId();
  const [shownKey, setShownKey] = useState(plainKey ?? '');
  if (plainKey !== null && plainKey !== shownKey) {
    setShownKey(plainKey);
  }

  const copy = async () => {
    const copied = await writeToClipboard(shownKey);
    if (copied) {
      notify.success(ISSUED_API_KEY_MESSAGES.copied);
    } else {
      notify.error(ISSUED_API_KEY_MESSAGES.copyFailed);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{ISSUED_API_KEY_MESSAGES.title}</DialogTitle>
        <DialogDescription>
          {ISSUED_API_KEY_MESSAGES.storageNotice}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{ISSUED_API_KEY_MESSAGES.keyLabel}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={inputId}
            value={shownKey}
            readOnly
            autoComplete="off"
            spellCheck={false}
            translate="no"
            className="font-mono"
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <Button
            type="button"
            className="shrink-0"
            onClick={() => {
              void copy();
            }}
          >
            <CopyIcon aria-hidden="true" />
            {ISSUED_API_KEY_MESSAGES.copy}
          </Button>
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {ISSUED_API_KEY_MESSAGES.close}
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

// 平文はこのダイアログでだけ示し、閉じた後は文書にも部品の状態にも残さない
export function IssuedApiKeyDialog({
  plainKey,
  onClose,
  returnFocusRef,
}: IssuedApiKeyDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={plainKey !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        onBlur={(event) => {
          // 受け付けなかったダイアログの外の押下は、フォーカスを<body>へ落として戻さないため、ダイアログへ戻す。ウィンドウの切り替えではフォーカスのある要素が変わらないため何もしない
          if (
            event.relatedTarget === null &&
            document.activeElement === document.body
          ) {
            contentRef.current?.focus();
          }
        }}
        // 外側の押下で控える前の平文を失わないよう、閉じるのは「閉じる」とEscapeに限る
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        // 開く元の操作をDialogTriggerにしない呼び出し方では、Radix UIが閉じた後のフォーカスの戻り先を持たないため、開いた元の操作へ戻す
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const element = returnFocusRef.current;
          if (element?.isConnected === true) {
            element.focus();
          }
        }}
      >
        <IssuedApiKeyBody plainKey={plainKey} />
      </DialogContent>
    </Dialog>
  );
}
