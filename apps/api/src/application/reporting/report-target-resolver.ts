import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import { REPORT_LIST_EXCERPT_MAX } from '../../../common-lib/reporting/report-case-rules.ts';
import type { ReportTargetKind } from '../../../common-lib/reporting/report-rules.ts';
import { truncateGraphemes } from '../../../common-lib/text/graphemes.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type {
  CommentRecord,
  CommentStore,
} from '../../../lib/core/engagement/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import type {
  ReportTargetKey,
  ReportTargetResolver,
  ResolvedReportTarget,
  ReportTargetView,
} from './ports.ts';

export const reportTargetKeyOf = (
  key: Pick<ReportTargetKey, 'kind' | 'targetId'>,
): string => `${key.kind}:${key.targetId ?? ''}`;

export const UNAVAILABLE_TARGET_VIEW: ReportTargetView = Object.freeze({
  available: false,
  handle: null,
  label: null,
  excerpt: null,
  productName: null,
  productHandle: null,
});

const uniqueIds = (ids: readonly (string | null)[]): readonly string[] => [
  ...new Set(ids.filter((id): id is string => id !== null)),
];

const targetIdsOf = (
  keys: readonly ReportTargetKey[],
  kind: ReportTargetKind,
): readonly string[] =>
  uniqueIds(keys.filter((key) => key.kind === kind).map((key) => key.targetId));

// 他の閲覧者に表示されるコメントだけを通報の対象にするため、削除・非公開化・匿名化を除く
const isShownComment = (
  comment: CommentRecord,
): comment is CommentRecord & { readonly authorUserId: string } =>
  comment.deletedAt === null &&
  comment.hiddenAt === null &&
  comment.anonymizedAt === null &&
  comment.authorUserId !== null;

const excerptOf = (comment: CommentRecord): string =>
  comment.anonymizedAt === null
    ? truncateGraphemes(comment.bodyMarkdown, REPORT_LIST_EXCERPT_MAX)
    : '';

interface FoundTargets {
  readonly users: ReadonlyMap<string, UserSummaryRecord>;
  readonly products: ReadonlyMap<string, ProductSummaryRecord>;
  readonly comments: ReadonlyMap<string, CommentRecord>;
}

const userViewOf = (user: UserSummaryRecord | undefined): ReportTargetView =>
  user === undefined
    ? UNAVAILABLE_TARGET_VIEW
    : {
        ...UNAVAILABLE_TARGET_VIEW,
        available: true,
        handle: user.handle,
        label: user.nickname,
      };

const productViewOf = (
  product: ProductSummaryRecord | undefined,
): ReportTargetView =>
  product === undefined
    ? UNAVAILABLE_TARGET_VIEW
    : {
        ...UNAVAILABLE_TARGET_VIEW,
        available: true,
        handle: product.handle,
        label: product.name,
      };

// 管理者が判断できるよう、削除・非公開化のコメントも抜粋を返す
const commentViewOf = (
  comment: CommentRecord | undefined,
  product: ProductSummaryRecord | undefined,
): ReportTargetView =>
  comment === undefined
    ? UNAVAILABLE_TARGET_VIEW
    : {
        ...UNAVAILABLE_TARGET_VIEW,
        available: true,
        excerpt: excerptOf(comment),
        productName: product?.name ?? null,
        productHandle: product?.handle ?? null,
      };

const viewOf = (
  key: ReportTargetKey,
  found: FoundTargets,
): ReportTargetView => {
  if (key.targetId === null) {
    return UNAVAILABLE_TARGET_VIEW;
  }
  switch (key.kind) {
    case 'user': {
      return userViewOf(found.users.get(key.targetId));
    }
    case 'product': {
      return productViewOf(found.products.get(key.targetId));
    }
    case 'comment': {
      return commentViewOf(
        found.comments.get(key.targetId),
        key.productId === null ? undefined : found.products.get(key.productId),
      );
    }
  }
};

@injectable()
export class DirectoryReportTargetResolver implements ReportTargetResolver {
  constructor(
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly profiles: UserProfileDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
    private readonly comments: CommentStore,
  ) {}

  async resolveForSubmission(
    kind: ReportTargetKind,
    ref: string,
  ): Promise<ResolvedReportTarget | undefined> {
    switch (kind) {
      case 'user': {
        return this.#resolveUser(ref);
      }
      case 'product': {
        return this.#resolveProduct(ref);
      }
      case 'comment': {
        return this.#resolveComment(ref);
      }
    }
  }

  async describe(
    keys: readonly ReportTargetKey[],
  ): Promise<ReadonlyMap<string, ReportTargetView>> {
    const userIds = targetIdsOf(keys, 'user');
    const commentIds = targetIdsOf(keys, 'comment');
    const productIds = uniqueIds(
      keys.flatMap((key) => {
        if (key.targetId === null) {
          return [];
        }
        if (key.kind === 'product') {
          return [key.targetId];
        }
        return key.kind === 'comment' ? [key.productId] : [];
      }),
    );
    const [users, products, comments] = await Promise.all([
      userIds.length === 0
        ? new Map<string, UserSummaryRecord>()
        : this.profiles.findSummaries(userIds, 'not-withdrawn'),
      productIds.length === 0
        ? new Map<string, ProductSummaryRecord>()
        : this.products.findSummaries(productIds, 'not-deleted'),
      commentIds.length === 0
        ? new Map<string, CommentRecord>()
        : this.comments.findByIds(commentIds),
    ]);
    const found: FoundTargets = { users, products, comments };
    return new Map(
      keys.map((key): [string, ReportTargetView] => [
        reportTargetKeyOf(key),
        viewOf(key, found),
      ]),
    );
  }

  async #resolveUser(
    handle: string,
  ): Promise<ResolvedReportTarget | undefined> {
    if (checkHandleFormat(handle, USER_HANDLE_RULE) !== 'ok') {
      return undefined;
    }
    const resolution = await this.profiles.resolveHandle(handle);
    if (resolution.kind === 'none' || resolution.user.suspended) {
      return undefined;
    }
    return {
      kind: 'user',
      targetId: resolution.user.userId,
      ownerUserId: resolution.user.userId,
      productId: null,
    };
  }

  async #resolveProduct(
    productId: string,
  ): Promise<ResolvedReportTarget | undefined> {
    const product = await this.#findListedProduct(productId);
    return product === undefined
      ? undefined
      : {
          kind: 'product',
          targetId: product.productId,
          ownerUserId: product.ownerUserId,
          productId: product.productId,
        };
  }

  async #resolveComment(
    commentId: string,
  ): Promise<ResolvedReportTarget | undefined> {
    const comment = (await this.comments.findByIds([commentId])).get(commentId);
    if (comment === undefined || !isShownComment(comment)) {
      return undefined;
    }
    const [authors, product] = await Promise.all([
      this.profiles.findSummaries([comment.authorUserId], 'visible'),
      this.#findListedProduct(comment.productId),
    ]);
    if (!authors.has(comment.authorUserId) || product === undefined) {
      return undefined;
    }
    return {
      kind: 'comment',
      targetId: comment.commentId,
      ownerUserId: comment.authorUserId,
      productId: product.productId,
    };
  }

  // 他者に詳細が表示されるプロダクトは掲載中だけのため、可視でも未掲載なら対象にしない
  async #findListedProduct(
    productId: string,
  ): Promise<ProductSummaryRecord | undefined> {
    const product = (
      await this.products.findSummaries([productId], 'visible')
    ).get(productId);
    return product?.listed === true ? product : undefined;
  }
}
