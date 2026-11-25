import { useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import { BracketMatchCard } from './bracket-match-card.tsx';
import type { BracketViewRound } from './bracket-view-props.ts';

export interface BracketRoundColumnProps {
  readonly round: BracketViewRound;
  readonly className?: string;
}

export function BracketRoundColumn({
  round,
  className,
}: BracketRoundColumnProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <h2 id={headingId} className="text-base font-extrabold tracking-tight">
        {round.name}(<LaunchDateText date={round.date} />)
      </h2>
      {/* 横に並べた列では、後のラウンドのマッチが前のラウンドの対になる2試合の間に来るよう縦に散らす */}
      <ol className="flex flex-1 flex-col justify-around gap-3">
        {round.nodes.map((node) => (
          <li key={node.position}>
            <BracketMatchCard roundName={round.name} node={node} />
          </li>
        ))}
      </ol>
    </section>
  );
}
