import { RocketIcon } from 'lucide-react';

import { MatchCard } from '#/components/client/match/match-card';
import type { Match } from '#/components/client/match/model';
import {
  GoldCard,
  SponsorJoinCard,
  useShuffledAds,
} from '#/components/client/sponsor-ads';
import type { SponsorAd } from '#/components/client/sponsor-ads';
import { useDateTimeFormatter } from '#/lib/date-format';
import type { User } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { matchEnd, nextKickoff } from '../-model';
import type { ByeEntry } from '../-model';
import { ByeList } from './bye-list';
import { EmptyLineup } from './empty-lineup';
import { SectionHeading } from './section-heading';

type Props = {
  matches: Match[];
  byes: ByeEntry[];
  goldAds: SponsorAd[];
  isLive: boolean;
  user: User | null;
  onRequireLogin: () => void;
};

const MOBILE_GOLD_INTERVAL = 2;

export function QualifierSection({
  matches,
  byes,
  goldAds,
  isLive,
  user,
  onRequireLogin,
}: Props) {
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
