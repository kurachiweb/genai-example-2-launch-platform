import { TournamentBracketPage } from '../tournament/tournament-bracket-page.tsx';
import type { WeekBracketView } from './week-bracket-model.ts';
import { WEEK_BRACKET_COPY } from './week-tournament-messages.ts';

export interface WeekBracketPageProps {
  readonly bracket: WeekBracketView;
  // 開催中の定期の取り直しを続けるか。終了した週では使わない
  readonly autoRefresh: boolean;
  readonly onAutoRefreshChange: (checked: boolean) => void;
}

export function WeekBracketPage({
  bracket,
  autoRefresh,
  onAutoRefreshChange,
}: WeekBracketPageProps) {
  return (
    <TournamentBracketPage
      copy={WEEK_BRACKET_COPY}
      periodLabel={bracket.tournament.label}
      bracket={bracket}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={onAutoRefreshChange}
    />
  );
}
