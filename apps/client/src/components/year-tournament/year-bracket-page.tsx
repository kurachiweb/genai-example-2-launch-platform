import { TournamentBracketPage } from '../tournament/tournament-bracket-page.tsx';
import {
  type YearBracketView,
  yearBracketFinalDateOf,
} from './year-bracket-model.ts';
import { YEAR_BRACKET_COPY } from './year-tournament-messages.ts';

export interface YearBracketPageProps {
  readonly bracket: YearBracketView;
  // 開催中の定期の取り直しを続けるか。終了した年では使わない
  readonly autoRefresh: boolean;
  readonly onAutoRefreshChange: (checked: boolean) => void;
}

export function YearBracketPage({
  bracket,
  autoRefresh,
  onAutoRefreshChange,
}: YearBracketPageProps) {
  return (
    <TournamentBracketPage
      copy={YEAR_BRACKET_COPY}
      periodLabel={bracket.tournament.label}
      finalDate={yearBracketFinalDateOf(bracket)}
      bracket={bracket}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={onAutoRefreshChange}
    />
  );
}
