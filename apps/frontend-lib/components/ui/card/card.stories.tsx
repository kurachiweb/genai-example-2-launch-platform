import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { Button } from '../button/button.tsx';
import { Card } from './card.tsx';
import { CardAction } from './card-action.tsx';
import { CardContent } from './card-content.tsx';
import { CardDescription } from './card-description.tsx';
import { CardFooter } from './card-footer.tsx';
import { CardHeader } from './card-header.tsx';
import { CardTitle } from './card-title.tsx';

const meta = {
  title: '基本部品/Card',
  component: Card,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>
          <h2>あなたのプロダクト</h2>
        </CardTitle>
        <CardDescription>直近のローンチは予選の結果待ちです。</CardDescription>
      </CardHeader>
      <CardContent>
        <p>次回のローンチの予約は、予選の結果が確定してからできます。</p>
      </CardContent>
      <CardFooter>
        <Button>再ローンチを予約</Button>
      </CardFooter>
    </Card>
  ),
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>
          <h2>あなたのプロダクト</h2>
        </CardTitle>
        <CardDescription>直近のローンチは予選の結果待ちです。</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            編集
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>次回のローンチの予約は、予選の結果が確定してからできます。</p>
      </CardContent>
      <CardFooter>
        <Button>再ローンチを予約</Button>
      </CardFooter>
    </Card>
  ),
};

export const HeaderOnly: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>
          <h2>サポーター</h2>
        </CardTitle>
        <CardDescription>まだサポーターはいません。</CardDescription>
      </CardHeader>
    </Card>
  ),
};
