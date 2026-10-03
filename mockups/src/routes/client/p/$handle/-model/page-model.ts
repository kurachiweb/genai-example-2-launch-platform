import type { Match, MatchKind, Round } from '#/components/client/match/model';
import { addDays, addMinutes, atTime, isoDate, weekLabelOf } from '#/lib/clock';
import {
  CURRENT_USER,
  PRODUCTS,
  USERS,
  findProductByHandle,
} from '#/lib/mock-data';
import type { Product, User } from '#/lib/mock-data';

import { buildComments } from './comments';
import type { CommentNode } from './comments';
import { LONG_NAME, LONG_TAGLINE, descriptionOf } from './content';
import { buildTimeline } from './launches';
import type { HistoryMatch, Timeline } from './launches';
import type { ProductSearch } from './options';
import { planHistory } from './plan';

export type ViewerRole = ProductSearch['auth'];

export type ScreenshotVariant =
  'dashboard' | 'mobile' | 'editor' | 'chart' | 'landing';

export type Screenshot = {
  id: string;
  width: number;
  height: number;
  variant: ScreenshotVariant;
  palette: number;
};

export type Award = {
  id: string;
  kind: 'week' | 'year';
  period: string;
  decidedAt: Date;
};

export type Rating = {
  count: number;
  average: number | null;
  mine: number | null;
};

export type ProductRecord = {
  firstLaunch: Date | null;
  launchCount: number;
  wins: number;
  losses: number;
};

export type ProductModel = {
  product: Product;
  maker: User;
  viewer: User | null;
  role: ViewerRole;
  description: string;
  screenshots: Screenshot[];
  awards: Award[];
  rating: Rating;
  timeline: Timeline;
  record: ProductRecord;
  liveMatch: Match | null;
  // ローンチIDごとのコメント(キックオフ前のローンチには無い)
  comments: Record<string, CommentNode[]>;
};

const SCREENSHOT_SIZES: [number, number, ScreenshotVariant][] = [
  [1600, 1000, 'dashboard'],
  [750, 1500, 'mobile'],
  [1000, 1000, 'chart'],
  [1920, 820, 'landing'],
  [900, 1600, 'mobile'],
  [1440, 900, 'editor'],
  [1080, 1080, 'dashboard'],
  [1000, 1400, 'landing'],
  [1280, 800, 'chart'],
  [828, 1792, 'editor'],
];

const RATINGS: Record<ProductSearch['rating'], Rating> = {
  many: { count: 128, average: 4.6, mine: null },
  mine: { count: 128, average: 4.6, mine: 4 },
  one: { count: 1, average: 4, mine: null },
  zero: { count: 0, average: null, mine: null },
};

const COMMENT_COUNTS: Record<ProductSearch['comments'], number> = {
  many: 23,
  few: 3,
  none: 0,
};
const OLDER_LAUNCH_COMMENT_COUNTS = [4, 2];
const LATEST_COMMENT_MINUTES_AGO = 25;
const OLDER_COMMENTS_HOUR = 21;

const MAKER = USERS[4];
const LONG_MAKER = USERS[2];

function isWon(match: HistoryMatch): boolean {
  return ['win', 'bye', 'early'].includes(match.result);
}

function awardsOf(timeline: Timeline): Award[] {
  return timeline.launches.flatMap((launch) =>
    launch.matches
      .filter((match) => match.round === 'final' && isWon(match))
      .map((match): Award => ({
        id: match.id,
        kind: match.kind === 'year' ? 'year' : 'week',
        period:
          match.kind === 'year'
            ? `${isoDate(match.date).slice(0, 4)}年`
            : weekLabelOf(launch.date),
        decidedAt: match.date,
      })),
  );
}

function recordOf(timeline: Timeline): ProductRecord {
  const started = timeline.launches.filter((l) => l.state !== 'scheduled');
  const matches = started.flatMap((launch) => launch.matches);
  return {
    firstLaunch: started.length > 0 ? started[started.length - 1].date : null,
    launchCount: started.length,
    wins: matches.filter(isWon).length,
    losses: matches.filter((m) => !isWon(m)).length,
  };
}

function commentsOf(
  search: ProductSearch,
  timeline: Timeline,
  maker: User,
  viewer: User | null,
): Record<string, CommentNode[]> {
  const started = timeline.launches.filter((l) => l.state !== 'scheduled');
  // 自分のコメントを持てるのはコメントを投稿できるログインユーザーのみ
  const commenter =
    search.auth === 'user' || search.auth === 'owner' ? viewer : null;
  return Object.fromEntries(
    started.map((launch, index) => {
      const isLatest = index === 0;
      const count =
        search.comments === 'none'
          ? 0
          : isLatest
            ? COMMENT_COUNTS[search.comments]
            : OLDER_LAUNCH_COMMENT_COUNTS[
                (index - 1) % OLDER_LAUNCH_COMMENT_COUNTS.length
              ];
      const latestAt = isLatest
        ? addMinutes(timeline.now, -LATEST_COMMENT_MINUTES_AGO)
        : atTime(addDays(launch.date, 1), OLDER_COMMENTS_HOUR);
      return [
        launch.id,
        buildComments({
          launchId: launch.id,
          count,
          replies: isLatest ? search.replies : 'none',
          long: search.text === 'long',
          viewer: isLatest ? commenter : null,
          maker,
          latestAt,
          earliestAt: addMinutes(launch.date, 30),
        }),
      ];
    }),
  );
}

function screenshotsOf(search: ProductSearch, product: Product): Screenshot[] {
  const count = Number(search.shots);
  return SCREENSHOT_SIZES.slice(0, count).map(
    ([width, height, variant], i) => ({
      id: `shot-${i + 1}`,
      width,
      height,
      variant,
      palette: product.art.palette + i,
    }),
  );
}

const LIVE_SCORES: Record<ProductSearch['votes'], [number, number]> = {
  '130-100': [130, 100],
  '4-30': [4, 30],
  '30-30': [30, 30],
  '0-0': [0, 0],
};

function liveMatchOf(
  search: ProductSearch,
  product: Product,
  live: { kind: MatchKind; round: Round | null } | null,
): Match | null {
  if (!live) return null;
  const opponents = PRODUCTS.filter((p) => p.id !== product.id);
  const opponent =
    opponents[(Number(product.id.slice(-3)) * 7) % opponents.length];
  const [left, right] = LIVE_SCORES[search.votes];
  return {
    id: `live-${live.kind}`,
    kind: live.kind,
    left: product,
    right: opponent,
    leftVotes: left,
    rightVotes: right,
    isOwn: search.auth === 'owner',
    upvoted: null,
    // 自身のページへのリンクは出さず、トーナメントの相手は予選勝利済み(掲載済み)のためリンクする
    linked: { left: false, right: live.kind !== 'qualifier' },
  };
}

// 存在しない、または閲覧できないプロダクトはnull(どの理由でも同じ404を表示する)
export function buildModel(
  search: ProductSearch,
  handle: string,
): ProductModel | null {
  const found = findProductByHandle(handle);
  if (!found || search.visibility === 'unavailable') return null;
  if (search.visibility === 'unlisted' && search.auth !== 'owner') return null;
  const plan = planHistory(search);
  if (!plan) return null;

  const long = search.text === 'long';
  const product: Product = long
    ? { ...found, name: LONG_NAME, tagline: LONG_TAGLINE }
    : found;
  const viewer = search.auth === 'guest' ? null : CURRENT_USER;
  const maker =
    search.auth === 'owner' ? CURRENT_USER : long ? LONG_MAKER : MAKER;
  const timeline = buildTimeline(search, plan, product);

  return {
    product,
    maker,
    viewer,
    role: search.auth,
    description: descriptionOf(product.name, long),
    screenshots: screenshotsOf(search, product),
    awards: awardsOf(timeline),
    rating: RATINGS[search.rating],
    timeline,
    record: recordOf(timeline),
    liveMatch: liveMatchOf(search, product, timeline.live),
    comments: commentsOf(search, timeline, maker, viewer),
  };
}
