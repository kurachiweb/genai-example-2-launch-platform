import type { Meta, StoryObj } from '@storybook/tanstack-react';
import type { ComponentProps } from 'react';

import { Tabs } from './tabs.tsx';
import { TabsContent } from './tabs-content.tsx';
import { TabsList } from './tabs-list.tsx';
import type { TabsListVariant } from './tabs-list-variants.ts';
import { TabsTrigger } from './tabs-trigger.tsx';

interface RankingTabsProps extends ComponentProps<typeof Tabs> {
  readonly variant?: TabsListVariant;
  readonly disablesMonthly?: boolean;
}

function RankingTabs({
  variant,
  disablesMonthly = false,
  ...props
}: RankingTabsProps) {
  return (
    <Tabs defaultValue="daily" {...props}>
      <TabsList variant={variant} aria-label="ランキングの期間">
        <TabsTrigger value="daily">日間</TabsTrigger>
        <TabsTrigger value="weekly">週間</TabsTrigger>
        <TabsTrigger value="monthly" disabled={disablesMonthly}>
          月間
        </TabsTrigger>
      </TabsList>
      <TabsContent value="daily">今日の投票数で並べます。</TabsContent>
      <TabsContent value="weekly">直近7日間の投票数で並べます。</TabsContent>
      <TabsContent value="monthly">直近30日間の投票数で並べます。</TabsContent>
    </Tabs>
  );
}

const meta = {
  title: '基本部品/Tabs',
  component: RankingTabs,
  argTypes: {
    variant: { control: 'select', options: ['default', 'line'] },
    orientation: { control: 'select', options: ['horizontal', 'vertical'] },
  },
} satisfies Meta<typeof RankingTabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Line: Story = {
  args: { variant: 'line' },
};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
};

export const DisabledTab: Story = {
  args: { disablesMonthly: true },
};
