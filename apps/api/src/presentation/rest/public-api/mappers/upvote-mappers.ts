import { encodeCursor } from '../../../../../lib/core/pagination/opaque-cursor.ts';
import type {
  UpvoteHistoryEntry,
  UpvoteHistoryPage,
} from '../../../../application/match/upvote-history-reader.ts';
import type { PublicSupporterPage } from '../../../../application/public-api/public-supporter-reader.ts';
import type { LoadedMedia, MediaLookupRequest } from '../media-lookup.ts';
import type {
  Supporter,
  SupporterList,
  UpvoteHistoryList,
  UpvoteHistoryListEntry,
} from '../schemas/upvotes.ts';
import {
  LOGO_IMAGE_VARIANT,
  type PublicApiOrigins,
  toApiImage,
  userSummaryOf,
} from './common-mappers.ts';

export const mediaRequestOfSupporters = (
  page: PublicSupporterPage,
): MediaLookupRequest => ({
  fileIds: [],
  userIds: page.supporters.map(({ userId }) => userId),
});

// 一覧の照会の後に退会・停止した利用者は一括の照会で読めないため、一覧から除く
export function toSupporterListPage(
  page: PublicSupporterPage,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): SupporterList {
  return {
    data: page.supporters.flatMap(({ userId, upvotedAt }): Supporter[] => {
      const user = userSummaryOf(userId, loaded, origins);
      return user === null
        ? []
        : [{ user, upvoted_at: upvotedAt.toISOString() }];
    }),
    meta: {
      has_next: page.hasNextPage,
      next_cursor:
        page.endCursor === null
          ? null
          : encodeCursor({
              upvotedAt: page.endCursor.upvotedAt,
              upvoteId: page.endCursor.upvoteId,
            }),
    },
  };
}

export const mediaRequestOfUpvoteHistory = (
  page: UpvoteHistoryPage,
): MediaLookupRequest => ({
  fileIds: page.entries.map(({ product }) => product.logoFileId),
  userIds: [],
});

// 未掲載のプロダクトもハンドルを返し、リンクするかどうかは利用者がlistedで判断する
const toUpvoteHistoryEntry = (
  entry: UpvoteHistoryEntry,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): UpvoteHistoryListEntry => ({
  match_id: entry.matchId,
  kind: entry.kind,
  round: entry.round,
  stage: entry.stage,
  match_date: entry.matchDate,
  live: entry.live,
  product: {
    handle: entry.product.handle,
    name: entry.product.name,
    logo: toApiImage(
      loaded.files.get(entry.product.logoFileId),
      LOGO_IMAGE_VARIANT,
      origins.images,
    ),
    listed: entry.product.listed,
  },
});

export const toUpvoteHistoryListPage = (
  page: UpvoteHistoryPage,
  loaded: LoadedMedia,
  origins: PublicApiOrigins,
): UpvoteHistoryList => ({
  data: page.entries.map((entry) =>
    toUpvoteHistoryEntry(entry, loaded, origins),
  ),
  meta: {
    total: page.totalCount,
    has_next: page.hasNextPage,
    next_cursor: page.endCursor,
  },
});
