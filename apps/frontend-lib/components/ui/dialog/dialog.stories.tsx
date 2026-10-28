import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Button } from '../button/button.tsx';
import { Dialog } from './dialog.tsx';
import { DialogClose } from './dialog-close.tsx';
import { DialogContent } from './dialog-content.tsx';
import { DialogDescription } from './dialog-description.tsx';
import { DialogFooter } from './dialog-footer.tsx';
import { DialogHeader } from './dialog-header.tsx';
import { DialogTitle } from './dialog-title.tsx';
import { DialogTrigger } from './dialog-trigger.tsx';

const meta = {
  title: '重ねて表示する部品/Dialog',
  component: Dialog,
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="destructive">プロダクトを削除</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>プロダクトを削除しますか?</DialogTitle>
          <DialogDescription>
            削除したプロダクトと集まった投票は元に戻せません。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">キャンセル</Button>
          </DialogClose>
          <Button variant="destructive">削除する</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: { defaultOpen: true },
};

export const FooterCloseButton: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Dialog {...args}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>投稿を受け付けました</DialogTitle>
          <DialogDescription>
            審査が終わるとプロダクトのページが公開されます。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  ),
};
