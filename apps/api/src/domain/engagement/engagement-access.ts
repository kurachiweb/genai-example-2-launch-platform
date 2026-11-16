import type {
  LaunchRecord,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';

// 照会の結果に無いプロダクト(可視でない・論理削除)と未掲載の他者のプロダクトを区別せず閲覧できないとする
export function canViewProduct(
  product: ProductSummaryRecord | undefined,
  viewerUserId: string | undefined,
): boolean {
  if (product === undefined || !product.visible) {
    return false;
  }
  return product.listed || product.ownerUserId === viewerUserId;
}

export function isCommentableLaunch(launch: LaunchRecord | undefined): boolean {
  return launch?.status === 'in_progress' || launch?.status === 'finished';
}
