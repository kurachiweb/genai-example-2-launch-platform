import type { Meta, StoryObj } from '@storybook/tanstack-react';
import type { ComponentProps } from 'react';

import { Button } from '../button/button.tsx';
import { Sheet } from './sheet.tsx';
import { SheetClose } from './sheet-close.tsx';
import { SheetContent } from './sheet-content.tsx';
import type { SheetSide } from './sheet-content-variants.ts';
import { SheetDescription } from './sheet-description.tsx';
import { SheetFooter } from './sheet-footer.tsx';
import { SheetHeader } from './sheet-header.tsx';
import { SheetTitle } from './sheet-title.tsx';
import { SheetTrigger } from './sheet-trigger.tsx';

interface MenuSheetProps extends ComponentProps<typeof Sheet> {
  readonly side?: SheetSide;
}

function MenuSheet({ side, ...props }: MenuSheetProps) {
  return (
    <Sheet {...props}>
      <SheetTrigger asChild>
        <Button variant="outline">メニューを開く</Button>
      </SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>メニュー</SheetTitle>
          <SheetDescription>移動先を選んでください。</SheetDescription>
        </SheetHeader>
        <nav aria-label="メニュー" className="flex flex-col gap-2 px-4">
          <a href="#ranking" className="underline-offset-4 hover:underline">
            ランキング
          </a>
          <a href="#products" className="underline-offset-4 hover:underline">
            プロダクト一覧
          </a>
        </nav>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">閉じる</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const meta = {
  title: '重ねて表示する部品/Sheet',
  component: MenuSheet,
  argTypes: {
    side: { control: 'select', options: ['top', 'right', 'bottom', 'left'] },
  },
} satisfies Meta<typeof MenuSheet>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Right: Story = {
  args: { defaultOpen: true, side: 'right' },
};

export const Left: Story = {
  args: { defaultOpen: true, side: 'left' },
};

export const Top: Story = {
  args: { defaultOpen: true, side: 'top' },
};

export const Bottom: Story = {
  args: { defaultOpen: true, side: 'bottom' },
};
