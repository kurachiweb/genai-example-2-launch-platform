import { EyeOffIcon, PackageOpenIcon, RocketIcon } from 'lucide-react';

import { Button } from '#/components/ui/button';

import type { ProfileModel } from '../-model/page-model';
import { LaunchedProductCard } from './launched-product-card';
import { LoadMore } from './load-more';
import { ProductCardSkeletons } from './product-card-skeletons';
import { TabEmpty } from './tab-empty';
import { usePagedList } from './use-paged-list';

type Props = {
  model: ProfileModel;
  loadMoreFails: boolean;
};

const LOAD_MORE_SKELETONS = 2;

export function LaunchedProductsPanel({ model, loadMoreFails }: Props) {
  const { products, role, suspended } = model;
  const isOwner = role === 'owner';
  const list = usePagedList(products.length, loadMoreFails);
  const hasUnlisted = products.some((entry) => !entry.listed);

  if (products.length === 0) {
    const canLaunch = isOwner && !suspended;
    return (
      <TabEmpty
        icon={PackageOpenIcon}
        title="まだローンチしたプロダクトはありません。"
        description={
          canLaunch
            ? 'ローンチ日には予選マッチで1対1の対戦が始まります。勝利するとディレクトリに掲載されます。'
            : undefined
        }
        action={
          canLaunch && (
            <Button size="lg" asChild>
              <a href="#">
                <RocketIcon aria-hidden="true" />
                ローンチを予約🚀
              </a>
            </Button>
          )
        }
      />
    );
  }

  return (
    <div>
      {isOwner && hasUnlisted && !suspended && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm leading-relaxed">
          <EyeOffIcon
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          未掲載のプロダクトはあなたにだけ表示されています。予選で勝利するとディレクトリに掲載され、誰でも見られるようになります。
        </p>
      )}
      <ul className="space-y-3">
        {products.slice(0, list.visible).map((entry) => (
          <LaunchedProductCard
            key={entry.product.id}
            entry={entry}
            isOwner={isOwner}
            suspended={suspended}
            imagesBroken={model.ownImagesBroken}
            now={model.now}
          />
        ))}
      </ul>
      <LoadMore
        list={list}
        skeleton={<ProductCardSkeletons count={LOAD_MORE_SKELETONS} />}
      />
    </div>
  );
}
