import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';

import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../../lib/utilities/query/live-refresh.ts';
import { parseTournamentYear } from '../../../../common-lib/tournament/year-period.ts';
import { NotFoundPage } from '../../../components/pages/not-found-page.tsx';
import { TournamentBracketError } from '../../../components/tournament/tournament-bracket-error.tsx';
import {
  isTournamentBracketLive,
  tournamentBracketRefetchIntervalOf,
} from '../../../components/tournament/tournament-bracket-model.ts';
import { YearBracketPage } from '../../../components/year-tournament/year-bracket-page.tsx';
import { YEAR_BRACKET_COPY } from '../../../components/year-tournament/year-tournament-messages.ts';
import type { ClientViewer } from '../../../graphql/viewer.ts';
import { yearBracketQueryOptions } from '../../../graphql/year-tournament.ts';
import {
  buildYearBracketHead,
  type YearBracketHeadInput,
} from '../../../head/page-heads.ts';

export const Route = createFileRoute('/tournaments/year/$year')({
  // 1年以後の4桁でない年は存在し得ないため照会しない。開催中は表示中に取り直すため、loaderは毎回新しく取得し、部品は表示した時点では取り直さない
  loader: async ({
    context: { queryClient, viewer },
    params: { year },
  }): Promise<YearBracketHeadInput> => {
    if (parseTournamentYear(year) === undefined) {
      throw notFound();
    }
    const { yearBracket } = await queryClient.query({
      ...yearBracketQueryOptions(viewer, year),
      staleTime: 0,
    });
    if (yearBracket === null) {
      throw notFound();
    }
    return {
      year: yearBracket.tournament.year,
      label: yearBracket.tournament.label,
    };
  },
  head: ({ loaderData }) => buildYearBracketHead(loaderData),
  errorComponent: YearBracketError,
  // 表示中の取り直しで部品が投げた404も、loaderの404と同じ画面にする
  notFoundComponent: NotFoundPage,
  component: YearBracketRoute,
});

function YearBracketError() {
  return <TournamentBracketError copy={YEAR_BRACKET_COPY} />;
}

// 同じ経路のまま別の年へ移ったときに、タブの既定のラウンドと自動更新の状態を初めから作り直すため、年ごとに作り直す
function YearBracketRoute() {
  const { year } = Route.useParams();
  const { viewer } = Route.useRouteContext();
  return <YearBracketContent key={year} year={year} viewer={viewer} />;
}

interface YearBracketContentProps {
  readonly year: string;
  readonly viewer: ClientViewer | null;
}

function YearBracketContent({ year, viewer }: YearBracketContentProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { data } = useSuspenseQuery({
    ...yearBracketQueryOptions(viewer, year),
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: (query) =>
      tournamentBracketRefetchIntervalOf(
        query.state.data?.yearBracket,
        autoRefresh,
      ),
    refetchOnWindowFocus: (query) =>
      isTournamentBracketLive(query.state.data?.yearBracket),
    refetchOnMount: false,
  });
  if (data.yearBracket === null) {
    throw notFound();
  }
  return (
    <YearBracketPage
      bracket={data.yearBracket}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
    />
  );
}
