import { useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import type { MatchByeFragment } from '../../graphql/generated/graphql.ts';
import { ByeCard } from './bye-card.tsx';
import { BYE_LIST_HEADING } from './bye-messages.ts';

export interface ByeListProps {
  // 区画の見出し(h2)の下に置く前提で、一覧の見出しをh3、項目の名称をh4にする
  readonly byes: readonly MatchByeFragment[];
  readonly className?: string;
}

export function ByeList({ byes, className }: ByeListProps) {
  const headingId = useId();
  if (byes.length === 0) {
    return null;
  }
  return (
    <div className={cn('mt-4', className)}>
      <h3
        id={headingId}
        className="mb-2 text-sm font-semibold text-muted-foreground"
      >
        {BYE_LIST_HEADING}
      </h3>
      <ul aria-labelledby={headingId} className="grid gap-3 xl:grid-cols-2">
        {byes.map((bye) => (
          <li key={`${bye.match.id}:${bye.entry.id}`}>
            <ByeCard bye={bye} />
          </li>
        ))}
      </ul>
    </div>
  );
}
