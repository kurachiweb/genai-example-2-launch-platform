import { Tabs } from '../../../lib/components/ui/tabs/tabs.tsx';
import { TabsContent } from '../../../lib/components/ui/tabs/tabs-content.tsx';
import { TabsList } from '../../../lib/components/ui/tabs/tabs-list.tsx';
import { TabsTrigger } from '../../../lib/components/ui/tabs/tabs-trigger.tsx';
import { BRACKET_ROUND_TABS_LABEL } from './bracket-messages.ts';
import { BracketRoundColumn } from './bracket-round-column.tsx';
import { defaultRoundOf } from './bracket-view-model.ts';
import type { BracketViewProps } from './bracket-view-props.ts';

export interface BracketRoundTabsProps {
  readonly rounds: BracketViewProps['rounds'];
  readonly className?: string;
}

const valueOf = (round: number): string => String(round);

export function BracketRoundTabs({ rounds, className }: BracketRoundTabsProps) {
  const defaultRound = defaultRoundOf(rounds);
  if (defaultRound === undefined) {
    return null;
  }
  return (
    <Tabs defaultValue={valueOf(defaultRound)} className={className}>
      <TabsList
        variant="line"
        aria-label={BRACKET_ROUND_TABS_LABEL}
        className="h-auto w-full flex-wrap justify-start gap-0 border-b border-border p-0"
      >
        {rounds.map(({ round, name }) => (
          <TabsTrigger
            key={round}
            value={valueOf(round)}
            className="h-auto min-h-11 flex-none px-3 font-bold whitespace-normal after:bg-primary"
          >
            {name}
          </TabsTrigger>
        ))}
      </TabsList>
      {rounds.map((round) => (
        <TabsContent
          key={round.round}
          value={valueOf(round.round)}
          className="mt-4 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BracketRoundColumn round={round} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
