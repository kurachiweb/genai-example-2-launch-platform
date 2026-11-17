import { FullTimeCountdownSection } from '../components/top/full-time-countdown-section.tsx';
import { qualifierBoardSectionOf } from '../components/top/qualifier-board-section.tsx';
import type {
  QualifierListInsert,
  TopPageSection,
} from '../components/top/top-page-section-types.ts';
import { WeekFinalShowcase } from '../components/week-tournament/week-final-showcase.tsx';
import { WeekTournamentSection } from '../components/week-tournament/week-tournament-section.tsx';
import { YearTournamentSection } from '../components/year-tournament/year-tournament-section.tsx';

// 予選の一覧の対戦カードの間に指定の件数ごとに差し込む区画の登録箇所。各specが自分の差し込みを追記する
export const QUALIFIER_LIST_INSERTS: readonly QualifierListInsert[] =
  Object.freeze([]);

// トップページの置き場所ごとに並べる区画の登録箇所。各specが自分の区画を追記する
export const TOP_PAGE_SECTIONS: readonly TopPageSection[] = Object.freeze([
  {
    id: 'match-engine.countdown',
    placement: 'banner',
    order: 10,
    component: FullTimeCountdownSection,
  },
  {
    id: 'tournament-week.final',
    placement: 'showcase',
    order: 20,
    component: WeekFinalShowcase,
  },
  {
    id: 'tournament-year.matches',
    placement: 'main',
    order: 10,
    component: YearTournamentSection,
  },
  {
    id: 'tournament-week.matches',
    placement: 'main',
    order: 20,
    component: WeekTournamentSection,
  },
  {
    id: 'match-engine.qualifiers',
    placement: 'main',
    order: 30,
    component: qualifierBoardSectionOf(QUALIFIER_LIST_INSERTS),
  },
]);
