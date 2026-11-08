import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { Dialog } from './dialog/dialog.tsx';
import { DialogContent } from './dialog/dialog-content.tsx';
import { DialogTitle } from './dialog/dialog-title.tsx';
import { DialogTrigger } from './dialog/dialog-trigger.tsx';
import { Popover } from './popover/popover.tsx';
import { PopoverContent } from './popover/popover-content.tsx';
import { PopoverTrigger } from './popover/popover-trigger.tsx';
import { Sheet } from './sheet/sheet.tsx';
import { SheetContent } from './sheet/sheet-content.tsx';
import { SheetTitle } from './sheet/sheet-title.tsx';
import { SheetTrigger } from './sheet/sheet-trigger.tsx';

interface InnerFormProps {
  readonly onInnerSubmit: () => void;
}

function InnerForm({ onInnerSubmit }: InnerFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onInnerSubmit();
      }}
    >
      <label>
        名前
        <input name="name" />
      </label>
      <button type="submit">送信</button>
    </form>
  );
}

interface OuterFormProps {
  readonly onOuterSubmit: () => void;
  readonly children: ReactNode;
}

function OuterForm({ onOuterSubmit, children }: OuterFormProps) {
  return (
    <form
      aria-label="外側"
      onSubmit={(event) => {
        event.preventDefault();
        onOuterSubmit();
      }}
    >
      {children}
    </form>
  );
}

const containers = [
  {
    name: 'ダイアログ',
    element: (props: InnerFormProps) => (
      <Dialog>
        <DialogTrigger asChild>
          <button type="button">開く</button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>見出し</DialogTitle>
          <InnerForm {...props} />
        </DialogContent>
      </Dialog>
    ),
  },
  {
    name: 'シート',
    element: (props: InnerFormProps) => (
      <Sheet>
        <SheetTrigger asChild>
          <button type="button">開く</button>
        </SheetTrigger>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>見出し</SheetTitle>
          <InnerForm {...props} />
        </SheetContent>
      </Sheet>
    ),
  },
  {
    name: 'ポップオーバー',
    element: (props: InnerFormProps) => (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">開く</button>
        </PopoverTrigger>
        <PopoverContent>
          <InnerForm {...props} />
        </PopoverContent>
      </Popover>
    ),
  },
] as const;

describe('外側のフォームの中に置いたポータルの中のフォーム', () => {
  describe.each(containers)('$name', ({ element }) => {
    test.each([
      [
        '送信ボタンの押下',
        async () => userEvent.click(page.getByRole('button', { name: '送信' })),
      ],
      ['入力欄でのEnter', async () => userEvent.keyboard('{Enter}')],
    ])('%sは、内側のフォームだけを送信する', async (_name, submit) => {
      const onInnerSubmit = vi.fn<() => void>();
      const onOuterSubmit = vi.fn<() => void>();
      await render(
        <OuterForm onOuterSubmit={onOuterSubmit}>
          {element({ onInnerSubmit })}
        </OuterForm>,
      );
      await userEvent.click(page.getByRole('button', { name: '開く' }));
      await userEvent.click(page.getByRole('textbox', { name: '名前' }));

      await submit();

      await expect.poll(() => onInnerSubmit.mock.calls.length).toBe(1);
      expect(onOuterSubmit).not.toHaveBeenCalled();
    });
  });
});
