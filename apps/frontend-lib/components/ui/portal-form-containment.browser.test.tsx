import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { Dialog } from './dialog/dialog.tsx';
import { DialogContent } from './dialog/dialog-content.tsx';
import { DialogTitle } from './dialog/dialog-title.tsx';
import { DialogTrigger } from './dialog/dialog-trigger.tsx';
import { DropdownMenu } from './dropdown-menu/dropdown-menu.tsx';
import { DropdownMenuContent } from './dropdown-menu/dropdown-menu-content.tsx';
import { DropdownMenuTrigger } from './dropdown-menu/dropdown-menu-trigger.tsx';
import { Popover } from './popover/popover.tsx';
import { PopoverContent } from './popover/popover-content.tsx';
import { PopoverTrigger } from './popover/popover-trigger.tsx';
import { Select } from './select/select.tsx';
import { SelectContent } from './select/select-content.tsx';
import { SelectItem } from './select/select-item.tsx';
import { SelectTrigger } from './select/select-trigger.tsx';
import { SelectValue } from './select/select-value.tsx';
import { Sheet } from './sheet/sheet.tsx';
import { SheetContent } from './sheet/sheet-content.tsx';
import { SheetTitle } from './sheet/sheet-title.tsx';
import { SheetTrigger } from './sheet/sheet-trigger.tsx';
import { Tooltip } from './tooltip/tooltip.tsx';
import { TooltipContent } from './tooltip/tooltip-content.tsx';
import { TooltipProvider } from './tooltip/tooltip-provider.tsx';
import { TooltipTrigger } from './tooltip/tooltip-trigger.tsx';

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
    opener: { role: 'button', name: '開く' },
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
    opener: { role: 'button', name: '開く' },
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
    opener: { role: 'button', name: '開く' },
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
  {
    name: 'ドロップダウンメニュー',
    opener: { role: 'button', name: '開く' },
    element: (props: InnerFormProps) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">開く</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <InnerForm {...props} />
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
  {
    name: 'セレクト',
    opener: { role: 'combobox' },
    element: (props: InnerFormProps) => (
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="開く" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">項目</SelectItem>
          <InnerForm {...props} />
        </SelectContent>
      </Select>
    ),
  },
  {
    name: 'ツールチップ',
    opener: { role: 'button', name: '開く', hover: true },
    element: (props: InnerFormProps) => (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">開く</button>
          </TooltipTrigger>
          <TooltipContent>
            <InnerForm {...props} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ),
  },
] as const;

describe('外側のフォームの中に置いたポータルの中のフォーム', () => {
  describe.each(containers)('$name', ({ element, opener }) => {
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
      const openerLocator =
        'name' in opener
          ? page.getByRole(opener.role, { name: opener.name })
          : page.getByRole(opener.role);
      await ('hover' in opener
        ? userEvent.hover(openerLocator)
        : userEvent.click(openerLocator));
      await userEvent.click(
        page.getByRole('textbox', { name: '名前' }).first(),
      );

      await submit();

      await expect.poll(() => onInnerSubmit.mock.calls.length).toBe(1);
      expect(onOuterSubmit).not.toHaveBeenCalled();
    });
  });
});
