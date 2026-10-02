import { ClockIcon } from 'lucide-react';

import { MatchCard } from '#/components/client/match/match-card';
import { ROUND_LABEL } from '#/components/client/match/model';
import type { Match, Round } from '#/components/client/match/model';
import { formatCountdown } from '#/lib/countdown';
import { useDateTimeFormatter } from '#/lib/date-format';

import { matchEndOf } from '../-model/clock';
import { UNVERIFIED_MESSAGE, usePageContext } from './page-context';
import { useMockCountdown } from './use-mock-countdown';

type Props = {
  match: Match;
  round: Round | null;
  date: Date;
};

function stageLabel(match: Match, round: Round | null): string {
  if (match.kind === 'qualifier') return '予選';
  const prefix =
    match.kind === 'week' ? 'Weekトーナメント' : 'Yearトーナメント';
  return `${prefix}${round ? ROUND_LABEL[round] : ''}`;
}

export function LiveMatchSection({ match, round, date }: Props) {
  const { role, viewer, now, requireLogin } = usePageContext();
  const endsAt = matchEndOf(date);
  const countdown = useMockCountdown(endsAt, now);
  const timeFormatter = useDateTimeFormatter('time');
  const stage = stageLabel(match, round);

  return (
    <section aria-labelledby="live-match-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2
          id="live-match-heading"
          className="flex items-center gap-2 text-xl font-extrabold tracking-tight"
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold tracking-widest text-primary-foreground"
            translate="no"
          >
            <span
              className="size-2 rounded-full bg-primary-foreground"
              aria-hidden="true"
            />
            LIVE
          </span>
          {stage}を戦っています
        </h2>
        <p className="text-sm text-muted-foreground">
          {role === 'owner'
            ? 'サポーターの応援が集まっています。'
            : 'Upvoteで応援しましょう！'}
        </p>
      </div>
      <MatchCard
        match={match}
        isLive
        user={viewer}
        round={round ?? undefined}
        accent={match.kind === 'qualifier' ? undefined : 'gold'}
        restriction={role === 'unverified' ? UNVERIFIED_MESSAGE : null}
        onRequireLogin={() => requireLogin('upvote')}
        caption={
          <span className="inline-flex items-center gap-1.5">
            <ClockIcon className="size-3.5" aria-hidden="true" />
            フルタイムまであと
            <span className="scoreboard-digits text-sm text-primary">
              {countdown ? formatCountdown(countdown) : '--:--:--'}
            </span>
            <time dateTime={endsAt.toISOString()}>
              ({timeFormatter.format(endsAt)}終了)
            </time>
          </span>
        }
      />
    </section>
  );
}
