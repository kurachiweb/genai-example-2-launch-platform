import { useMemo, useState } from 'react';
import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from '@tanstack/react-router';

import { SiteFooter } from '#/components/client/site-footer';
import { SiteHeader } from '#/components/client/site-header';
import {
  GoldSidebar,
  LegendBanner,
  SilverList,
} from '#/components/client/sponsor-ads';
import { LoginDialog } from '#/components/client/login-dialog';
import { StatePanel } from '#/components/client/state-panel';
import { StadiumDefs } from '#/components/client/stadium-pitch/stadium-pitch';

import { FinalShowcase } from './-components/final-showcase';
import { FullTimeCountdown } from './-components/full-time-countdown';
import { GuestHero } from './-components/hero';
import { QualifierSection } from './-components/qualifier-section';
import { TournamentSection } from './-components/tournament-section';
import {
  DEFAULT_SEARCH,
  OPTIONS,
  OPTION_LABELS,
  buildModel,
  validateSearch,
} from './-model';
import type { TopSearch } from './-model';

const PANEL_SECTIONS = [
  { keys: Object.keys(OPTIONS) as (keyof typeof OPTIONS)[] },
] as const;

export const Route = createFileRoute('/client/top/')({
  validateSearch,
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  component: TopPage,
});

function TopPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const model = useMemo(() => buildModel(search), [search]);
  const [loginOpen, setLoginOpen] = useState(false);
  const requireLogin = () => setLoginOpen(true);
  // 状態切り替えでUpvote等のローカル状態を確実に初期化する
  const stateKey = `${search.phase}-${search.votes}-${search.auth}-${search.early}`;

  const tournaments = [
    { kind: 'year' as const, data: model.year },
    { kind: 'week' as const, data: model.week },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <StadiumDefs />
      <SiteHeader user={model.user} />
      <div className="mx-auto w-full max-w-7xl px-4 pt-4">
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {model.isLive && <FullTimeCountdown />}
          <LegendBanner ads={model.ads.legend} />
        </div>
      </div>

      {!model.user && (
        <div className="mx-auto w-full max-w-7xl px-4">
          <GuestHero />
        </div>
      )}

      {tournaments.map(({ kind, data }) =>
        data && data.round === 'final' ? (
          <FinalShowcase
            key={`${kind}-${stateKey}`}
            kind={kind}
            match={data.matches[0]}
            isLive={model.isLive}
            user={model.user}
            onRequireLogin={requireLogin}
          />
        ) : null,
      )}

      <main className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 pt-10">
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          {tournaments.map(({ kind, data }) =>
            data && data.round !== 'final' ? (
              <TournamentSection
                key={`${kind}-${data.round}-${stateKey}-${search.bye}`}
                kind={kind}
                round={data.round}
                matches={data.matches}
                byes={data.byes}
                isLive={model.isLive}
                user={model.user}
                onRequireLogin={requireLogin}
              />
            ) : null,
          )}
          <QualifierSection
            key={`qualifiers-${search.qualifiers}-${stateKey}-${search.bye}`}
            matches={model.qualifiers}
            byes={model.qualifierByes}
            goldAds={model.ads.gold}
            isLive={model.isLive}
            user={model.user}
            onRequireLogin={requireLogin}
          />
        </div>
        <GoldSidebar ads={model.ads.gold} user={model.user} />
      </main>

      <SilverList ads={model.ads.silver} user={model.user} />
      <SiteFooter />

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      <StatePanel
        sections={PANEL_SECTIONS}
        options={OPTIONS}
        labels={OPTION_LABELS}
        values={search}
        onChange={(key, value) =>
          navigate({
            search: (prev: TopSearch) => ({ ...prev, [key]: value }),
            replace: true,
            resetScroll: false,
          })
        }
      />
    </div>
  );
}
