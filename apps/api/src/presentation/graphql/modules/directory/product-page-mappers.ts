import type { ProductSummaryRecord } from '../../../../../lib/core/product/ports.ts';
import type { LiveMatchView } from '../../../../application/directory/live-match-reader.ts';
import type {
  ProductPageLaunchView,
  ProductPageView,
} from '../../../../application/directory/product-page-reader.ts';
import type {
  HistoryRow,
  MatchRecordSummary,
  OpponentView,
} from '../../../../domain/directory/match-history.ts';
import {
  MATCH_DECISION_VALUES,
  MATCH_ENTRY_RESULT_VALUES,
  MATCH_KIND_VALUES,
  MATCH_STAGE_VALUES,
  type MatchDecisionValue,
  type MatchEntryResultValue,
  type MatchKindValue,
  type MatchStageValue,
} from '../match/mappers.ts';
import {
  type ProductAwardModel,
  type ProductLaunchModel,
  toProductAward,
  toProductLaunch,
} from '../product/mappers.ts';
import { verifiedWebsiteUrl } from './mappers.ts';

export type ProductPageOpponentKindValue =
  'NONE' | 'PRIVATE' | 'UNLISTED' | 'LISTED';

// ロゴは項目のリゾルバが一括読み込みで引くため、IDだけを持つ。掲載中でない相手へのリンクを作らせないよう、ハンドルは掲載中の相手だけに持たせる
export interface ProductPageOpponentModel {
  readonly kind: ProductPageOpponentKindValue;
  readonly handle: string | null;
  readonly name: string | null;
  readonly logoFileId: string | null;
}

export interface ProductPageMatchModel {
  readonly id: string;
  readonly entryId: string;
  readonly kind: MatchKindValue;
  readonly round: number | null;
  readonly stage: MatchStageValue | null;
  readonly date: string;
  readonly result: MatchEntryResultValue;
  readonly decision: MatchDecisionValue;
  readonly endedEarly: boolean;
  readonly ownUpvoteCount: number;
  readonly opponentUpvoteCount: number | null;
  readonly opponent: ProductPageOpponentModel;
}

export interface ProductPageLaunchModel extends ProductLaunchModel {
  readonly kickedOff: boolean;
  readonly latestKickedOff: boolean;
  readonly matches: ProductPageMatchModel[];
}

export interface ProductPageScreenshotModel {
  readonly fileId: string;
}

// カテゴリ・ロゴ・スクリーンショットの画像・投稿者は項目のリゾルバが一括読み込みで引くため、IDだけを持つ
export interface ProductPageModel {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly categoryId: string;
  readonly websiteUrl: string;
  readonly logoFileId: string;
  readonly description: string;
  readonly screenshots: ProductPageScreenshotModel[];
  readonly ownerUserId: string;
  readonly viewerIsOwner: boolean;
  readonly listed: boolean;
  readonly awards: ProductAwardModel[];
  readonly record: MatchRecordSummary;
  readonly launches: ProductPageLaunchModel[];
}

export interface ProductPageRedirectModel {
  readonly handle: string;
}

// マッチは項目のリゾルバがmatch-engineの表示の一括読み込みで引くため、IDだけを持つ
export interface ProductLiveMatchModel {
  readonly serverTime: Date;
  readonly matchId: string | null;
  readonly awaitingChange: boolean;
}

const NO_OPPONENT: ProductPageOpponentModel = Object.freeze({
  kind: 'NONE',
  handle: null,
  name: null,
  logoFileId: null,
});

const PRIVATE_OPPONENT: ProductPageOpponentModel = Object.freeze({
  kind: 'PRIVATE',
  handle: null,
  name: null,
  logoFileId: null,
});

function toOpponent(
  opponent: OpponentView,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): ProductPageOpponentModel {
  if (opponent.kind === 'none') {
    return NO_OPPONENT;
  }
  const product =
    opponent.kind === 'private' ? undefined : opponents.get(opponent.productId);
  if (opponent.kind === 'private' || product === undefined) {
    return PRIVATE_OPPONENT;
  }
  return {
    kind: opponent.kind === 'listed' ? 'LISTED' : 'UNLISTED',
    handle: opponent.kind === 'listed' ? product.handle : null,
    name: product.name,
    logoFileId: product.logoFileId,
  };
}

const toProductPageMatch = (
  row: HistoryRow,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): ProductPageMatchModel => ({
  id: row.matchId,
  entryId: row.entryId,
  kind: MATCH_KIND_VALUES[row.kind],
  round: row.round,
  stage: row.stage === null ? null : MATCH_STAGE_VALUES[row.stage],
  date: row.matchDate,
  result: MATCH_ENTRY_RESULT_VALUES[row.result],
  decision: MATCH_DECISION_VALUES[row.decision],
  endedEarly: row.endedEarly,
  ownUpvoteCount: row.ownUpvoteCount,
  opponentUpvoteCount: row.opponentUpvoteCount,
  opponent: toOpponent(row.opponent, opponents),
});

const toProductPageLaunch = (
  launch: ProductPageLaunchView,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): ProductPageLaunchModel => ({
  ...toProductLaunch(launch, launch.summary),
  kickedOff: launch.kickedOff,
  latestKickedOff: launch.latestKickedOff,
  matches: launch.rows.map((row) => toProductPageMatch(row, opponents)),
});

export const toProductPage = (view: ProductPageView): ProductPageModel => ({
  id: view.product.productId,
  handle: view.product.handle,
  name: view.product.name,
  tagline: view.product.tagline,
  categoryId: view.product.category.id,
  websiteUrl: verifiedWebsiteUrl(view.product.websiteUrl),
  logoFileId: view.product.logoFileId,
  description: view.detail.descriptionMarkdown,
  screenshots: view.detail.screenshotFileIds.map((fileId) => ({ fileId })),
  ownerUserId: view.product.ownerUserId,
  viewerIsOwner: view.ownerView,
  listed: !view.unlisted,
  awards: view.awards.map(toProductAward),
  record: view.record,
  launches: view.launches.map((launch) =>
    toProductPageLaunch(launch, view.opponents),
  ),
});

export const toProductLiveMatch = (
  view: LiveMatchView,
): ProductLiveMatchModel => ({
  serverTime: view.serverTime,
  matchId: view.matchId,
  awaitingChange: view.awaitingChange,
});
