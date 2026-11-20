import { downloadPathOf } from '../../../../../common-lib/media/upload-protocol.ts';
import type { QuarantineReason as UpstreamQuarantineReason } from '../../../../../lib/core/media/media-file.ts';
import type { AdminCommentItem } from '../../../../application/moderation/admin-comment-reader.ts';
import type {
  AdminProductDetail as AdminProductDetailView,
  AdminProductItem,
} from '../../../../application/moderation/admin-product-reader.ts';
import type { AdminRatingItem } from '../../../../application/moderation/admin-rating-reader.ts';
import type { QuarantinedImageItem } from '../../../../application/moderation/quarantined-image-reader.ts';
import type {
  AdminComment,
  AdminMediaFile,
  AdminProduct,
  AdminProductDetail,
  AdminQuarantinedImage,
  AdminRating,
  AdminUserSummary,
  ModerationNote,
  QuarantineReason,
} from '../../generated/resolvers-types.ts';
import {
  ADMIN_COMMENT_STATES,
  ADMIN_PRODUCT_LAUNCH_STATES,
  ADMIN_PRODUCT_VISIBILITIES,
  ADMIN_RATING_STATES,
  QUARANTINE_REASONS,
} from './inputs.ts';
import { toModerationConnection } from './resolver-support.ts';

interface ModerationConnection<TNode> {
  readonly nodes: TNode[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

// 生成したリゾルバの型が変更できる配列を求めるため、接続の項目を新しい配列にする
export function toConnectionResult<TItem, TNode>(
  items: readonly TItem[],
  nextCursor: string | null | undefined,
  toNode: (item: TItem) => TNode,
): ModerationConnection<TNode> {
  const { nodes, pageInfo } = toModerationConnection(items, nextCursor, toNode);
  return { nodes: [...nodes], pageInfo };
}

// 入力の写像の表(GraphQLの列挙→上流の値)を逆に引き、上流の照会の値をGraphQLの列挙へ写す
function graphQLValueOf<TKey extends string, TValue extends string>(
  table: Readonly<Record<TKey, TValue>>,
): (value: TValue) => TKey {
  const keys = new Map(
    (Object.entries(table) as [TKey, TValue][]).map(([key, value]) => [
      value,
      key,
    ]),
  );
  return (value) => {
    const key = keys.get(value);
    if (key === undefined) {
      throw new Error(`GraphQLの列挙に対応の無い上流の値です: "${value}"`);
    }
    return key;
  };
}

const quarantineReasonOf = graphQLValueOf(QUARANTINE_REASONS);

const launchStateOf = graphQLValueOf(ADMIN_PRODUCT_LAUNCH_STATES);

const visibilityOf = graphQLValueOf(ADMIN_PRODUCT_VISIBILITIES);

const commentStateOf = graphQLValueOf(ADMIN_COMMENT_STATES);

const ratingStateOf = graphQLValueOf(ADMIN_RATING_STATES);

interface MediaFileSource {
  readonly id: string;
  readonly quarantined: boolean;
  readonly quarantineReasons: readonly UpstreamQuarantineReason[];
}

interface UserSummarySource {
  readonly userId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly suspended: boolean;
}

interface NoteSource {
  readonly reason: string | null;
  readonly occurredAt: Date;
}

// 隔離中の画像も表示できるよう、変換配信ではなく管理者側のサイトと同じオリジンの中継の経路を返す
export const toAdminMediaFile = (file: MediaFileSource): AdminMediaFile => ({
  id: file.id,
  path: downloadPathOf(file.id),
  quarantined: file.quarantined,
  quarantineReasons: file.quarantineReasons.map((reason): QuarantineReason =>
    quarantineReasonOf(reason),
  ),
});

const toUserSummary = (
  user: UserSummarySource | null,
): AdminUserSummary | null =>
  user === null
    ? null
    : {
        id: user.userId,
        handle: user.handle,
        nickname: user.nickname,
        suspended: user.suspended,
      };

const toNote = (note: NoteSource | null): ModerationNote | null =>
  note === null ? null : { reason: note.reason, occurredAt: note.occurredAt };

export const toAdminProduct = (item: AdminProductItem): AdminProduct => ({
  id: item.productId,
  handle: item.handle,
  name: item.name,
  logo:
    item.logo === null
      ? null
      : toAdminMediaFile({ ...item.logo, id: item.logo.fileId }),
  owner: toUserSummary(item.owner),
  category: item.category,
  latestLaunchDate: item.latestLaunch?.launchDate ?? null,
  latestLaunchState:
    item.latestLaunch === null ? null : launchStateOf(item.latestLaunch.state),
  visibility: visibilityOf(item.visibility),
});

// ローンチとマッチの状態・種別・結果は、画面が上流の値をキーにした表示名の表で引くため生の値のまま返す
export const toAdminProductDetail = (
  detail: AdminProductDetailView,
): AdminProductDetail => ({
  product: toAdminProduct(detail.product),
  tagline: detail.tagline,
  descriptionMarkdown: detail.descriptionMarkdown,
  websiteUrl: detail.websiteUrl,
  screenshots: detail.screenshots.map((file) =>
    toAdminMediaFile({ ...file, id: file.fileId }),
  ),
  hiddenAt: detail.hiddenAt,
  latestHide: toNote(detail.latestHide),
  ratingSummary: detail.ratingSummary,
  launches: detail.launches.map((launch) => ({
    id: launch.launchId,
    number: launch.number,
    launchDate: launch.launchDate,
    status: launch.state,
    matches: launch.matches.map((match) => ({
      id: match.matchId,
      kind: match.kind,
      round: match.round,
      stage: match.stage,
      matchDate: match.matchDate,
      upvoteCount: match.upvoteCount,
      result: match.result,
      opponentName: match.opponentName,
    })),
  })),
});

export const toAdminComment = (item: AdminCommentItem): AdminComment => ({
  id: item.commentId,
  excerpt: item.excerpt,
  author: toUserSummary(item.author),
  productName: item.productName,
  productId: item.productId,
  launchId: item.launchId,
  launchNumber: item.launchNumber,
  createdAt: item.createdAt,
  state: commentStateOf(item.state),
  latestHide: toNote(item.latestHide),
});

export const toAdminRating = (item: AdminRatingItem): AdminRating => ({
  id: item.ratingId,
  rater: toUserSummary(item.rater),
  productName: item.productName,
  productId: item.productId,
  score: item.score,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  state: ratingStateOf(item.state),
  latestInvalidation: toNote(item.latestInvalidation),
});

export const toAdminRatingConnection = (page: {
  readonly ratings: readonly AdminRatingItem[];
  readonly nextCursor: string | null;
}): ModerationConnection<AdminRating> =>
  toConnectionResult(page.ratings, page.nextCursor, toAdminRating);

// 用途は画面が表示名の表で引くため生の値のまま返す
export const toAdminQuarantinedImage = (
  item: QuarantinedImageItem,
): AdminQuarantinedImage => ({
  file: toAdminMediaFile(item.file),
  purpose: item.purpose,
  owner: item.owner,
  quarantinedAt: item.quarantinedAt,
  findings: [...item.findings],
});
