import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';

import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../../lib/utilities/query/live-refresh.ts';
import { parseIsoWeek } from '../../../../common-lib/tournament/week-period.ts';
import { NotFoundPage } from '../../../components/pages/not-found-page.tsx';
import { TournamentBracketError } from '../../../components/tournament/tournament-bracket-error.tsx';
import {
  isTournamentBracketLive,
  tournamentBracketRefetchIntervalOf,
} from '../../../components/tournament/tournament-bracket-model.ts';
import { WeekBracketPage } from '../../../components/week-tournament/week-bracket-page.tsx';
import { WEEK_BRACKET_COPY } from '../../../components/week-tournament/week-tournament-messages.ts';
import type { ClientViewer } from '../../../graphql/viewer.ts';
import { weekBracketQueryOptions } from '../../../graphql/week-tournament.ts';
import {
  buildWeekBracketHead,
  type WeekBracketHeadInput,
} from '../../../head/page-heads.ts';

export const Route = createFileRoute('/tournaments/week/$week')({
  // 形式に合わない週・暦に無い週は存在し得ないため照会しない。開催中は表示中に取り直すため、loaderは毎回新しく取得し、部品は表示した時点では取り直さない
  loader: async ({
    context: { queryClient, viewer },
    params: { week },
  }): Promise<WeekBracketHeadInput> => {
    if (parseIsoWeek(week) === undefined) {
      throw notFound();
    }
    const { weekBracket } = await queryClient.query({
      ...weekBracketQueryOptions(viewer, week),
      staleTime: 0,
    });
    if (weekBracket === null) {
      throw notFound();
    }
    return {
      week: weekBracket.tournament.week,
      label: weekBracket.tournament.label,
    };
  },
  head: ({ loaderData }) => buildWeekBracketHead(loaderData),
  errorComponent: WeekBracketError,
  // 表示中の取り直しで部品が投げた404も、loaderの404と同じ画面にする
  notFoundComponent: NotFoundPage,
  component: WeekBracketRoute,
});

function WeekBracketError() {
  return <TournamentBracketError copy={WEEK_BRACKET_COPY} />;
}

// 同じ経路のまま別の週へ移ったときに、タブの既定のラウンドと自動更新の状態を初めから作り直すため、週ごとに作り直す
function WeekBracketRoute() {
  const { week } = Route.useParams();
  const { viewer } = Route.useRouteContext();
  return <WeekBracketContent key={week} week={week} viewer={viewer} />;
}

interface WeekBracketContentProps {
  readonly week: string;
  readonly viewer: ClientViewer | null;
}

function WeekBracketContent({ week, viewer }: WeekBracketContentProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { data } = useSuspenseQuery({
    ...weekBracketQueryOptions(viewer, week),
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: (query) =>
      tournamentBracketRefetchIntervalOf(
        query.state.data?.weekBracket,
        autoRefresh,
      ),
    refetchOnWindowFocus: (query) =>
      isTournamentBracketLive(query.state.data?.weekBracket),
    refetchOnMount: false,
  });
  if (data.weekBracket === null) {
    throw notFound();
  }
  return (
    <WeekBracketPage
      bracket={data.weekBracket}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
    />
  );
}
