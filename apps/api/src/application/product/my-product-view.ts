import type { UserAccountView } from '../../../lib/core/identity/account-guard.ts';
import type { MyProductView, ProductSnapshot } from './ports.ts';
import type { ProductState } from './product-state-evaluator.ts';

// 掲載の条件はbackend-libの照会口のlisted(可視のプロダクトかつ予選で勝利したローンチがある)と同じにする
const isListed = (snapshot: ProductSnapshot, owner: UserAccountView): boolean =>
  !snapshot.hidden &&
  owner.status === 'active' &&
  owner.deletedAt === null &&
  snapshot.launches.some(
    ({ outcome, status }) => outcome === 'won' && status !== 'canceled',
  );

export function toMyProductView(
  snapshot: ProductSnapshot,
  state: ProductState,
  owner: UserAccountView,
): MyProductView {
  return {
    productId: snapshot.productId,
    handle: snapshot.handle,
    previousHandle: snapshot.previousHandle,
    name: snapshot.name,
    tagline: snapshot.tagline,
    category: snapshot.category,
    websiteUrl: snapshot.websiteUrl,
    descriptionMarkdown: snapshot.descriptionMarkdown,
    logoFileId: snapshot.logoFileId,
    screenshotFileIds: snapshot.screenshotFileIds,
    hidden: snapshot.hidden,
    listed: isListed(snapshot, owner),
    version: snapshot.version,
    state,
  };
}
