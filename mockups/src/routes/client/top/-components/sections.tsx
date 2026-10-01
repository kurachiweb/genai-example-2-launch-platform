import { CalendarIcon, RocketIcon, TrophyIcon } from 'lucide-react';

import {
  GoldCard,
  SponsorJoinCard,
  useShuffledAds,
} from '#/components/client/sponsor-ads';
import type { SponsorAd } from '#/components/client/sponsor-ads';
import { StadiumPitch } from '#/components/client/stadium-pitch/stadium-pitch';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { useDateTimeFormatter } from '#/lib/date-format';
import type { User } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { matchEnd, nextKickoff, ROUND_LABEL, finalDate } from '../-model';
import type { ByeEntry, Match, Round } from '../-model';
import { ByeCard } from './bye-card';
import { MatchCard } from './match-card';

type CommonProps = {
  isLive: boolean;
  user: User | null;
  onRequireLogin: () => void;
};

/* ---------- トーナメント(決勝以外) ---------- */

type TournamentProps = CommonProps & {
  kind: 'week' | 'year';
  round: Round;
  matches: Match[];
  byes: ByeEntry[];
};

export function TournamentSection({
  kind,
  round,
  matches,
  byes,
  isLive,
  user,
  onRequireLogin,
}: TournamentProps) {
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

/* ---------- 予選 ---------- */

type QualifierProps = CommonProps & {
  matches: Match[];
  byes: ByeEntry[];
  goldAds: SponsorAd[];
};

const MOBILE_GOLD_INTERVAL = 2;

export function QualifierSection({
  matches,
  byes,
  goldAds,
  isLive,
  user,
  onRequireLogin,
}: QualifierProps) {
  const timeFormatter = useDateTimeFormatter('time');
  const matchEndAt = matchEnd();
  const kickoffAt = nextKickoff();
  const orderedAds = useShuffledAds(goldAds);
  const insertedCount = Math.min(
    orderedAds.length,
    Math.floor(matches.length / MOBILE_GOLD_INTERVAL),
  );
  const remainingAds = orderedAds.slice(insertedCount);
  // 早期終了したマッチも本日開催された予選マッチとして数える
  const heldCount =
    matches.length + byes.filter((bye) => bye.reason === 'early').length;

  return (
    <section aria-labelledby="starting-lineup">
      <SectionHeading
        id="starting-lineup"
        icon={<RocketIcon className="size-5 text-primary" aria-hidden="true" />}
        title="予選"
        meta={
          <>
            <span>本日の予選マッチ {heldCount}試合</span>
            {isLive ? (
              <span>
                フルタイム{' '}
                <time dateTime={matchEndAt.toISOString()}>
                  {timeFormatter.format(matchEndAt)}
                </time>
              </span>
            ) : (
              <span>
                明日のキックオフ{' '}
                <time dateTime={kickoffAt.toISOString()}>
                  {timeFormatter.format(kickoffAt)}
                </time>
              </span>
            )}
          </>
        }
      />

      {matches.length === 0 && byes.length === 0 ? (
        <EmptyLineup user={user} />
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {matches.map((match, index) => {
            const adIndex = (index + 1) / MOBILE_GOLD_INTERVAL - 1;
            const insertAd =
              Number.isInteger(adIndex) && adIndex < insertedCount
                ? orderedAds[adIndex]
                : null;
            return (
              <div
                key={match.id}
                className={cn(
                  'contents',
                  index === 0 && 'xl:[&>article]:col-span-2',
                )}
              >
                <MatchCard
                  match={match}
                  isLive={isLive}
                  user={user}
                  onRequireLogin={onRequireLogin}
                />
                {insertAd && (
                  <div className="lg:hidden">
                    <GoldCard ad={insertAd} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ByeList byes={byes} />

      {(remainingAds.length > 0 || user) && (
        <div
          className="mt-4 grid gap-4 lg:hidden"
          aria-label="Goldスポンサー広告"
        >
          {remainingAds.map((ad) => (
            <GoldCard key={ad.id} ad={ad} />
          ))}
          {user && <SponsorJoinCard />}
        </div>
      )}
    </section>
  );
}

function EmptyLineup({ user }: { user: User | null }) {
  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="absolute inset-0 opacity-70">
        <div className="hidden h-full w-full sm:block">
          <StadiumPitch
            orientation="horizontal"
            leftVotes={0}
            rightVotes={0}
            leftColors={['transparent', 'transparent']}
            rightColors={['transparent', 'transparent']}
            deserted
            finishedWinner="none"
          />
        </div>
        <div className="h-full w-full bg-(--stand-base) sm:hidden">
          <StadiumPitch
            orientation="vertical"
            leftVotes={0}
            rightVotes={0}
            leftColors={['transparent', 'transparent']}
            rightColors={['transparent', 'transparent']}
            deserted
            finishedWinner="none"
          />
        </div>
      </div>
      <div className="relative flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="rounded-xl bg-card/90 px-5 py-3 text-base font-semibold backdrop-blur">
          本日のマッチはありません。ローンチを予約しましょう。
        </p>
        <Button size="lg">
          <RocketIcon aria-hidden="true" />
          {user ? 'ローンチを予約🚀' : 'ログインしてローンチを予約🚀'}
        </Button>
      </div>
    </div>
  );
}

/* ---------- 不戦勝一覧 ---------- */

function ByeList({ byes }: { byes: ByeEntry[] }) {
  if (byes.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
        不戦勝
      </h3>
      <div className="grid gap-3 xl:grid-cols-2">
        {byes.map((entry) => (
          <ByeCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

/* ---------- 共通見出し ---------- */

function SectionHeading({
  id,
  icon,
  title,
  round,
  meta,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  round?: Round;
  meta: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-primary/20 pb-2">
      <h2
        id={id}
        className="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl"
      >
        {icon}
        {title}
        {round && (
          <Badge
            size="lg"
            className={`border-0 text-gold-foreground ${round === 'final' ? 'gold-gradient' : 'bg-silver'}`}
          >
            {ROUND_LABEL[round]}
          </Badge>
        )}
      </h2>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {meta}
      </p>
    </div>
  );
}
