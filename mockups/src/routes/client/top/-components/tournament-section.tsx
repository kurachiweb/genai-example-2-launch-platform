import { CalendarIcon, TrophyIcon } from 'lucide-react';

import { MatchCard } from '#/components/client/match/match-card';
import type { Match, Round } from '#/components/client/match/model';
import { useDateTimeFormatter } from '#/lib/date-format';
import type { User } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { finalDate } from '../-model';
import type { ByeEntry } from '../-model';
import { ByeList } from './bye-list';
import { SectionHeading } from './section-heading';

type Props = {
  kind: 'week' | 'year';
  round: Round;
  matches: Match[];
  byes: ByeEntry[];
  isLive: boolean;
  user: User | null;
  onRequireLogin: () => void;
};

export function TournamentSection({
  kind,
  round,
  matches,
  byes,
  isLive,
  user,
  onRequireLogin,
}: Props) {
  const dateFormatter = useDateTimeFormatter('date');
  const title = kind === 'week' ? 'Product of the Week' : 'Product of the Year';
  const headingId = `tournament-${kind}`;
  return (
    <section aria-labelledby={headingId}>
      <SectionHeading
        id={headingId}
        icon={
          <TrophyIcon className="size-5 text-gold-strong" aria-hidden="true" />
        }
        title={`${title}トーナメント`}
        round={round}
        meta={
          <>
            {kind === 'week' && <span>2026年第37週(9/7〜9/13)</span>}
            <span className="inline-flex items-center gap-1">
              <CalendarIcon className="size-4" aria-hidden="true" />
              決勝日
              <time dateTime={finalDate(round).toISOString().slice(0, 10)}>
                {dateFormatter.format(finalDate(round))}(UTC+8)
              </time>
            </span>
          </>
        }
      />
      {matches.length > 0 && (
        <div
          className={cn(
            'mt-4 grid gap-4',
            matches.length > 1 && 'xl:grid-cols-2',
          )}
        >
          {matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              isLive={isLive}
              user={user}
              accent="gold"
              round={round}
              onRequireLogin={onRequireLogin}
            />
          ))}
        </div>
      )}
      <ByeList byes={byes} />
    </section>
  );
}
