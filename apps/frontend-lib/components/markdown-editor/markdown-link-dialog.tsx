import { type SubmitEvent, useId, useRef, useState } from 'react';

import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import {
  LINK_APPLY_LABEL,
  LINK_CANCEL_LABEL,
  LINK_DIALOG_TITLE,
  LINK_REMOVE_LABEL,
  LINK_URL_FORMAT_ERROR,
  LINK_URL_LABEL,
} from '../../utilities/messages/markdown-messages.ts';
import { FormMessage } from '../form/form-message.tsx';
import { Button } from '../ui/button/button.tsx';
import { Dialog } from '../ui/dialog/dialog.tsx';
import { DialogClose } from '../ui/dialog/dialog-close.tsx';
import { DialogContent } from '../ui/dialog/dialog-content.tsx';
import { DialogFooter } from '../ui/dialog/dialog-footer.tsx';
import { DialogHeader } from '../ui/dialog/dialog-header.tsx';
import { DialogTitle } from '../ui/dialog/dialog-title.tsx';
import { Input } from '../ui/input/input.tsx';
import { Label } from '../ui/label/label.tsx';
import type { EditorController } from './editor-controller.ts';

export interface MarkdownLinkDialogProps {
  readonly open: boolean;
  readonly controller: EditorController;
  readonly onOpenChange: (open: boolean) => void;
}

// 表示部品がリンクにする参照(ホストを持つhttp・httpsの絶対URL・mailto・ページ内の参照)だけを受け付ける
const ACCEPTED_LINK_HREF = /^(?:https?:\/\/|mailto:|#)/iu;

const HTTP_LINK_HREF = /^https?:/iu;

const isAcceptedLinkHref = (href: string): boolean => {
  if (!ACCEPTED_LINK_HREF.test(href)) {
    return false;
  }
  if (!HTTP_LINK_HREF.test(href)) {
    return true;
  }
  return URL.canParse(href) && new URL(href).host !== '';
};

interface LinkFormProps {
  readonly controller: EditorController;
  readonly onDone: () => void;
}

// ダイアログを閉じると中身が取り除かれるため、開くたびに選択中のリンクから入力と形式違反の表示を始め直す
function LinkForm({ controller, onDone }: LinkFormProps) {
  const id = useId();
  const inputId = `${id}-url`;
  const messageId = `${id}-message`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [initialLink] = useState(() => controller.currentLink());
  const [value, setValue] = useState(initialLink?.href ?? '');
  const [submitted, setSubmitted] = useState(false);
  const href = trimWhiteSpace(value);
  const hasError = submitted && !isAcceptedLinkHref(href);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!isAcceptedLinkHref(href)) {
      setSubmitted(true);
      inputRef.current?.focus();
      return;
    }
    controller.applyLink(href);
    onDone();
  };

  return (
    <form noValidate className="grid gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{LINK_URL_LABEL}</Label>
        <Input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={hasError ? messageId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        {hasError ? (
          <FormMessage id={messageId}>{LINK_URL_FORMAT_ERROR}</FormMessage>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {LINK_CANCEL_LABEL}
          </Button>
        </DialogClose>
        {initialLink === undefined ? null : (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              controller.applyLink(undefined);
              onDone();
            }}
          >
            {LINK_REMOVE_LABEL}
          </Button>
        )}
        <Button type="submit">{LINK_APPLY_LABEL}</Button>
      </DialogFooter>
    </form>
  );
}

export function MarkdownLinkDialog({
  open,
  controller,
  onOpenChange,
}: MarkdownLinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          controller.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{LINK_DIALOG_TITLE}</DialogTitle>
        </DialogHeader>
        <LinkForm
          controller={controller}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
