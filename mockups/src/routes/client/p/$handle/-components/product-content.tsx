import { useMemo, useState } from 'react';
import { FlagIcon } from 'lucide-react';

import type { LoginPurpose } from '#/components/client/login-dialog';
import { Button } from '#/components/ui/button';

import type { ProductSearch } from '../-model/options';
import type { ProductModel } from '../-model/page-model';
import { Breadcrumbs } from './breadcrumbs';
import { LaunchHistory } from './launch-history';
import { LiveMatchSection } from './live-match-section';
import { OwnerCard } from './owner-card';
import { PageContext } from './page-context';
import type { PageContextValue, ReportTarget } from './page-context';
import { ProductDescription } from './product-description';
import { ProductHeader } from './product-header';
import { RatingCard } from './rating-card';
import { ReportDialog } from './report-dialog';
import { ScreenshotGallery } from './screenshot-gallery';
import { TrophyShelf } from './trophy-shelf';
import { UnlistedBanner } from './unlisted-banner';

type Props = {
  model: ProductModel;
  search: ProductSearch;
  onRequireLogin: (purpose: LoginPurpose) => void;
};

export function ProductContent({ model, search, onRequireLogin }: Props) {
  const [myRating, setMyRating] = useState(model.rating.mine);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const { product, timeline } = model;

  const context = useMemo<PageContextValue>(
    () => ({
      role: model.role,
      viewer: model.viewer,
      maker: model.maker,
      now: timeline.now,
      imagesBroken: search.images === 'broken',
      partial: search.partial,
      myRating,
      setMyRating,
      requireLogin: onRequireLogin,
      openReport: setReportTarget,
    }),
    [
      model,
      timeline.now,
      search.images,
      search.partial,
      myRating,
      onRequireLogin,
    ],
  );

  return (
    <PageContext value={context}>
      <div className="space-y-5">
        <Breadcrumbs category={product.category} name={product.name} />
        {search.visibility === 'unlisted' && <UnlistedBanner />}

        <div className="grid gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
            <ProductHeader
              product={product}
              maker={model.maker}
              record={model.record}
              awardCount={model.awards.length}
            />
            {model.liveMatch && timeline.live && (
              <LiveMatchSection
                match={model.liveMatch}
                round={timeline.live.round}
                date={timeline.live.date}
              />
            )}
          </div>

          <aside
            aria-label="評価と投稿者向けの操作"
            className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
          >
            <div className="space-y-4 lg:sticky lg:top-20">
              {model.role === 'owner' && (
                <OwnerCard search={search} timeline={timeline} />
              )}
              <RatingCard rating={model.rating} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-12 lg:col-start-1 lg:row-start-2">
            <TrophyShelf awards={model.awards} />
            <ScreenshotGallery
              shots={model.screenshots}
              productName={product.name}
            />
            <ProductDescription markdown={model.description} />
            <LaunchHistory
              launches={timeline.launches}
              product={product}
              comments={model.comments}
            />
            {model.role !== 'owner' && (
              <div className="flex justify-end border-t border-border pt-4">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() =>
                    setReportTarget({
                      kind: 'product',
                      label: 'このプロダクト',
                    })
                  }
                >
                  <FlagIcon aria-hidden="true" />
                  このプロダクトを通報
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
      <ReportDialog
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </PageContext>
  );
}
