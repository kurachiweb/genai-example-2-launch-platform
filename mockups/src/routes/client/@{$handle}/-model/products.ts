import type { AwardLabel } from '#/components/client/award-badges';
import type { HighlightTone } from '#/components/client/launch-highlight-chip';
import { ROUND_LABEL } from '#/components/client/match/model';
import type { Round } from '#/components/client/match/model';
import {
  addDays,
  at,
  isoDate,
  weekLabelOf,
  weekRoundDate,
  yearFinalAfter,
} from '#/lib/clock';
import { MAKER_PRODUCTS } from '#/lib/mock-data';
import type { Product } from '#/lib/mock-data';

import { LONG_PRODUCT_TEXTS } from './content';
import type { ProfileState } from './options';

// 各ローンチの結果。week-*・year-*はそのラウンドでの敗退、live-*はマッチ中、scheduledはキックオフ予定
export type LaunchOutcome =
  | 'qualifier-loss'
  | 'both-lose'
  | 'listed'
  | 'bye'
  | 'week-r1'
  | 'week-qf'
  | 'week-sf'
  | 'week-final'
  | 'potw'
  | 'potw-year-qf'
  | 'poty'
  | 'live-qualifier'
  | 'live-week'
  | 'scheduled';

export type LaunchHighlight = { label: string; tone: HighlightTone };

export type LaunchEntry = {
  id: string;
  number: number;
  date: Date;
  outcome: LaunchOutcome;
  highlights: LaunchHighlight[];
  // マッチ中のマッチの種別とラウンド
  live: { kind: 'qualifier' | 'week'; round: Round | null } | null;
};

export type LaunchedProduct = {
  product: Product;
  // 予選に1度でも勝利していればディレクトリに掲載される(FR-DIR-001)。未掲載は本人にだけ表示する
  listed: boolean;
  // 新しい順
  launches: LaunchEntry[];
  awards: AwardLabel[];
};

type Seed = [string, LaunchOutcome];

type Template = {
  productIndex: number;
  // 古い順。ローンチ間隔は再ローンチ規則(敗北後7日、勝利後はWeek・Yearの結果確定まで予約不可)を満たす
  multi: Seed[];
  single: Seed;
  // 進行状況が「マッチ中・キックオフ予定を含む」の場合に追加する最新のローンチ
  live?: Seed;
};

const WEEK_LIVE_ROUND: Round = 'sf';

const AWARD_OUTCOMES: LaunchOutcome[] = ['potw', 'potw-year-qf', 'poty'];
const WON_QUALIFIER: LaunchOutcome[] = [
  'listed',
  'bye',
  'week-r1',
  'week-qf',
  'week-sf',
  'week-final',
  'potw',
  'potw-year-qf',
  'poty',
  'live-week',
];

// Product of the Week(1回)・Product of the Week(複数回)・Product of the WeekとProduct of the Year
const AWARD_TEMPLATES: Template[] = [
  {
    productIndex: 7,
    multi: [
      ['2025-12-02', 'qualifier-loss'],
      ['2026-03-10', 'potw'],
    ],
    single: ['2026-03-10', 'listed'],
    live: ['2026-10-02', 'live-qualifier'],
  },
  {
    productIndex: 1,
    multi: [
      ['2024-10-08', 'qualifier-loss'],
      ['2024-11-05', 'potw'],
      ['2025-06-10', 'week-sf'],
      ['2025-09-16', 'listed'],
      ['2026-02-17', 'potw-year-qf'],
    ],
    single: ['2026-02-17', 'week-sf'],
    live: ['2026-09-24', 'live-week'],
  },
  {
    productIndex: 2,
    multi: [
      ['2025-07-15', 'week-qf'],
      ['2026-01-13', 'poty'],
    ],
    single: ['2026-01-13', 'week-qf'],
    live: ['2026-10-05', 'scheduled'],
  },
];

// 未掲載(予選前・予選敗北のみ)のプロダクト。本人にだけ表示する
const UNLISTED_TEMPLATES: Template[] = [
  {
    productIndex: 30,
    multi: [
      ['2026-06-02', 'both-lose'],
      ['2026-09-07', 'qualifier-loss'],
    ],
    single: ['2026-09-07', 'qualifier-loss'],
  },
  {
    productIndex: 31,
    multi: [['2026-08-18', 'qualifier-loss']],
    single: ['2026-08-18', 'qualifier-loss'],
  },
  {
    productIndex: 32,
    multi: [['2026-04-21', 'qualifier-loss']],
    single: ['2026-04-21', 'qualifier-loss'],
    live: ['2026-10-03', 'scheduled'],
  },
];

// 受賞以外の掲載済みプロダクトの結果の組み合わせ(古い順)と、全て1回の場合の結果
const GENERATED_PATTERNS: { multi: LaunchOutcome[]; single: LaunchOutcome }[] =
  [
    { multi: ['qualifier-loss', 'listed'], single: 'listed' },
    { multi: ['week-sf'], single: 'week-sf' },
    {
      multi: ['qualifier-loss', 'qualifier-loss', 'week-qf'],
      single: 'week-qf',
    },
    { multi: ['listed', 'qualifier-loss'], single: 'listed' },
    { multi: ['bye'], single: 'bye' },
    { multi: ['both-lose', 'week-r1'], single: 'week-r1' },
    { multi: ['listed'], single: 'listed' },
    {
      multi: ['qualifier-loss', 'listed', 'week-final'],
      single: 'week-final',
    },
    { multi: ['week-qf', 'qualifier-loss', 'listed'], single: 'week-qf' },
  ];
const GENERATED_COUNT = 27;
const GENERATED_LATEST = '2026-09-14';
const GENERATED_STEP_DAYS = 19;
const RELAUNCH_GAP_DAYS = 47;

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return at(year, month, day);
}

function generatedTemplates(): Template[] {
  const used = new Set([
    ...AWARD_TEMPLATES.map((t) => t.productIndex),
    ...UNLISTED_TEMPLATES.map((t) => t.productIndex),
  ]);
  const indexes = MAKER_PRODUCTS.map((_, index) => index).filter(
    (index) => !used.has(index),
  );
  return indexes.slice(0, GENERATED_COUNT).map((productIndex, k) => {
    const pattern = GENERATED_PATTERNS[k % GENERATED_PATTERNS.length];
    const latest = addDays(dateOf(GENERATED_LATEST), -k * GENERATED_STEP_DAYS);
    const count = pattern.multi.length;
    return {
      productIndex,
      multi: pattern.multi.map((outcome, i): Seed => [
        isoDate(addDays(latest, -(count - 1 - i) * RELAUNCH_GAP_DAYS)),
        outcome,
      ]),
      single: [isoDate(latest), pattern.single],
    };
  });
}

// 受賞バッジ無しの状態では、受賞したローンチをWeek決勝敗退に置き換える
function withoutAward(outcome: LaunchOutcome): LaunchOutcome {
  return AWARD_OUTCOMES.includes(outcome) ? 'week-final' : outcome;
}

const TOURNAMENT_EXIT: Partial<Record<LaunchOutcome, Round>> = {
  'week-r1': 'r1',
  'week-qf': 'qf',
  'week-sf': 'sf',
  'week-final': 'final',
};

function highlightsOf(outcome: LaunchOutcome): LaunchHighlight[] {
  const exit = TOURNAMENT_EXIT[outcome];
  if (exit) {
    return [{ label: `Week${ROUND_LABEL[exit]}敗退`, tone: 'muted' }];
  }
  switch (outcome) {
    case 'qualifier-loss':
      return [{ label: '予選敗北', tone: 'muted' }];
    case 'both-lose':
      return [{ label: '両者敗北(0対0)', tone: 'muted' }];
    case 'listed':
    case 'bye':
      return [{ label: 'ディレクトリ掲載', tone: 'primary' }];
    case 'potw':
      return [{ label: 'Product of the Week', tone: 'gold' }];
    case 'potw-year-qf':
      return [
        { label: 'Product of the Week', tone: 'gold' },
        { label: `Year${ROUND_LABEL.qf}敗退`, tone: 'muted' },
      ];
    case 'poty':
      return [
        { label: 'Product of the Week', tone: 'gold' },
        { label: 'Product of the Year', tone: 'gold' },
      ];
    case 'live-qualifier':
      return [{ label: '予選マッチ中', tone: 'live' }];
    case 'live-week':
      return [
        { label: `Week${ROUND_LABEL[WEEK_LIVE_ROUND]}マッチ中`, tone: 'live' },
      ];
    case 'scheduled':
      return [{ label: 'キックオフ予定', tone: 'primary' }];
    default:
      return [];
  }
}

function awardsOf(launches: LaunchEntry[]): AwardLabel[] {
  return launches.flatMap((launch): AwardLabel[] => {
    if (!AWARD_OUTCOMES.includes(launch.outcome)) return [];
    const week: AwardLabel = { kind: 'week', label: weekLabelOf(launch.date) };
    if (launch.outcome !== 'poty') return [week];
    const yearFinal = yearFinalAfter(weekRoundDate(launch.date, 3));
    return [
      week,
      { kind: 'year', label: `${isoDate(yearFinal).slice(0, 4)}年` },
    ];
  });
}

const LONG_TEXT_EVERY = 3;

function buildProduct(
  template: Template,
  state: ProfileState,
  position: number,
): LaunchedProduct {
  const base = MAKER_PRODUCTS[template.productIndex];
  // 同じ名称が一覧に並ばないよう、長い名称・タグラインは数件おきに1度ずつ使う
  const longText =
    state.text === 'long' && position % LONG_TEXT_EVERY === 0
      ? (LONG_PRODUCT_TEXTS.at(position / LONG_TEXT_EVERY) ?? null)
      : null;
  const product = longText ? { ...base, ...longText } : base;
  const seeds: Seed[] = [
    ...(state.launches === 'multi' ? template.multi : [template.single]),
    ...(state.progress === 'live' && template.live ? [template.live] : []),
  ];
  const launches = seeds
    .map(([iso, rawOutcome], index): LaunchEntry => {
      const outcome =
        state.awards === 'none' ? withoutAward(rawOutcome) : rawOutcome;
      return {
        id: `${product.id}-launch-${index + 1}`,
        number: index + 1,
        date: dateOf(iso),
        outcome,
        highlights: highlightsOf(outcome),
        live:
          outcome === 'live-qualifier'
            ? { kind: 'qualifier', round: null }
            : outcome === 'live-week'
              ? { kind: 'week', round: WEEK_LIVE_ROUND }
              : null,
      };
    })
    .reverse();
  return {
    product,
    listed: launches.some((launch) => WON_QUALIFIER.includes(launch.outcome)),
    launches,
    awards: awardsOf(launches),
  };
}

const FEW_COUNT = 3;
const FEW_UNLISTED_COUNT = 1;

// 最新ローンチ日が新しい順(キックオフ予定・マッチ中のプロダクトが先頭に来る)。未掲載は本人にだけ返す
export function buildLaunchedProducts(
  state: ProfileState,
  isOwner: boolean,
): LaunchedProduct[] {
  if (state.products === 'zero') return [];
  const listedTemplates =
    state.products === 'few'
      ? AWARD_TEMPLATES.slice(0, FEW_COUNT)
      : [...AWARD_TEMPLATES, ...generatedTemplates()];
  const unlistedTemplates = isOwner
    ? UNLISTED_TEMPLATES.slice(
        0,
        state.products === 'few' ? FEW_UNLISTED_COUNT : undefined,
      )
    : [];
  return [...listedTemplates, ...unlistedTemplates]
    .map((template, position) => buildProduct(template, state, position))
    .filter((entry) => isOwner || entry.listed)
    .sort(
      (a, b) =>
        b.launches[0].date.getTime() - a.launches[0].date.getTime() ||
        a.product.name.localeCompare(b.product.name),
    );
}
