import { commentBodyPathOf } from '../export-plan.ts';
import type {
  ExportComment,
  ExportFollow,
  ExportProductRef,
  ExportRating,
  ExportReport,
  ExportUpvote,
} from '../export-snapshot.ts';
import { toIsoUtc, toIsoUtcOrNull } from './export-formats.ts';

export interface CommentsDocumentEntry {
  readonly id: string;
  readonly launchId: string;
  readonly product: ExportProductRef | null;
  readonly parentCommentId: string | null;
  readonly bodyPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly hiddenByAdmin: boolean;
}

export interface UpvotesDocumentEntry {
  readonly matchId: string;
  readonly matchKind: ExportUpvote['matchKind'];
  readonly matchDate: string;
  readonly product: ExportProductRef | null;
  readonly upvotedAt: string;
}

export interface RatingsDocumentEntry {
  readonly product: ExportProductRef | null;
  readonly score: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invalidatedByAdmin: boolean;
}

export interface FollowsDocumentEntry {
  readonly user: {
    readonly handle: string;
    readonly nickname: string;
  };
  readonly followedAt: string;
}

export interface ReportsDocumentEntry {
  readonly id: string;
  readonly targetType: ExportReport['targetType'];
  readonly targetRef: string | null;
  readonly category: string;
  readonly reason: string;
  readonly createdAt: string;
}

function toProductRef(product: ExportProductRef | null) {
  return product === null
    ? null
    : { name: product.name, handle: product.handle };
}

export function buildCommentsDocument(
  comments: readonly ExportComment[],
): readonly CommentsDocumentEntry[] {
  return comments.map((comment) => ({
    id: comment.id,
    launchId: comment.launchId,
    product: toProductRef(comment.product),
    parentCommentId: comment.parentCommentId,
    bodyPath: commentBodyPathOf(comment.id),
    createdAt: toIsoUtc(comment.createdAt),
    updatedAt: toIsoUtc(comment.editedAt ?? comment.createdAt),
    deletedAt: toIsoUtcOrNull(comment.deletedAt),
    hiddenByAdmin: comment.hiddenByAdmin,
  }));
}

export function buildUpvotesDocument(
  upvotes: readonly ExportUpvote[],
): readonly UpvotesDocumentEntry[] {
  return upvotes.map((upvote) => ({
    matchId: upvote.matchId,
    matchKind: upvote.matchKind,
    matchDate: upvote.matchDate,
    product: toProductRef(upvote.product),
    upvotedAt: toIsoUtc(upvote.upvotedAt),
  }));
}

export function buildRatingsDocument(
  ratings: readonly ExportRating[],
): readonly RatingsDocumentEntry[] {
  return ratings.map((rating) => ({
    product: toProductRef(rating.product),
    score: rating.score,
    createdAt: toIsoUtc(rating.createdAt),
    updatedAt: toIsoUtc(rating.updatedAt),
    invalidatedByAdmin: rating.invalidatedByAdmin,
  }));
}

export function buildFollowsDocument(
  follows: readonly ExportFollow[],
): readonly FollowsDocumentEntry[] {
  return follows.map((follow) => ({
    user: { handle: follow.handle, nickname: follow.nickname },
    followedAt: toIsoUtc(follow.followedAt),
  }));
}

export function buildReportsDocument(
  reports: readonly ExportReport[],
): readonly ReportsDocumentEntry[] {
  return reports.map((report) => ({
    id: report.id,
    targetType: report.targetType,
    targetRef: report.targetRef,
    category: report.category,
    reason: report.reason,
    createdAt: toIsoUtc(report.createdAt),
  }));
}
