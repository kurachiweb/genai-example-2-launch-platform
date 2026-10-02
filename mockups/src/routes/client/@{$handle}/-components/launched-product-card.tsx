import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  PencilIcon,
} from 'lucide-react';

import { AwardBadges } from '#/components/client/award-badges';
import { ProductLogo } from '#/components/client/product-logo';
import { Button } from '#/components/ui/button';
import { categorySlugOf } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import type { LaunchedProduct } from '../-model/products';
import { LaunchRow } from './launch-row';

type Props = {
  entry: LaunchedProduct;
  isOwner: boolean;
  // 停止中は本人にもプロダクト詳細が404になるため、リンクと操作を出さずに薄く表示する
  suspended: boolean;
  imagesBroken: boolean;
  now: Date;
};

// 再ローンチを重ねたプロダクトは最新のローンチからこの件数だけ表示し、残りは開閉で示す
const VISIBLE_LAUNCHES = 3;

// 名称のリンクを項目全体に広げ(stretched link)、内側のボタン・リンクはz-10で前面に出して個別に操作できるようにする
export function LaunchedProductCard({
  entry,
  isOwner,
  suspended,
  imagesBroken,
  now,
}: Props) {
  const nameId = useId();
  const launchesId = useId();
  const [expanded, setExpanded] = useState(false);
  const { product, listed, launches, awards } = entry;
  const hidden = launches.length - VISIBLE_LAUNCHES;
  const shown = expanded ? launches : launches.slice(0, VISIBLE_LAUNCHES);
  const linked = !suspended;
  // 本人にだけ表示する未掲載のプロダクトは未審査のため、サイトへのリンクにugcを付ける
  const siteRel = listed ? 'noopener' : 'noopener ugc';

  return (
    <li>
      <article
        aria-labelledby={nameId}
        className={cn(
          'group relative grid gap-4 rounded-2xl border border-border bg-card p-4 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5',
          linked &&
            'transition-colors hover:border-primary/40 hover:bg-accent/30',
          suspended && 'opacity-60',
        )}
      >
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <ProductLogo
            product={product}
            size={64}
            broken={imagesBroken}
            className="size-14 rounded-xl shadow-sm sm:size-16"
          />
          <div className="min-w-0 flex-1">
            {(awards.length > 0 || !listed || suspended) && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                <AwardBadges awards={awards} />
                {!listed && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 bg-primary/5 px-2.5 py-0.5 text-xs font-bold text-primary">
                    <EyeOffIcon className="size-3.5" aria-hidden="true" />
                    未掲載・あなたにだけ表示
                  </span>
                )}
                {suspended && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                    <EyeOffIcon className="size-3.5" aria-hidden="true" />
                    非公開
                  </span>
                )}
              </div>
            )}
            <h3
              id={nameId}
              className="text-lg leading-snug font-extrabold tracking-tight wrap-anywhere"
            >
              {linked ? (
                <Link
                  to="/client/p/$handle"
                  params={{ handle: product.handle }}
                  className="text-foreground no-underline group-hover:underline after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                >
                  {product.name}
                </Link>
              ) : (
                product.name
              )}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm wrap-anywhere text-muted-foreground">
              {product.tagline}
            </p>
            <div className="mt-3">
              {linked ? (
                <Button
                  size="xs"
                  variant="outline"
                  asChild
                  className="relative z-10 h-auto min-h-6 max-w-full rounded-full py-0.5 whitespace-normal"
                >
                  <Link
                    to="/client/p"
                    search={{ category: categorySlugOf(product.category) }}
                    aria-label={`カテゴリ「${product.category}」のプロダクトをディレクトリで見る`}
                  >
                    <span className="wrap-anywhere">{product.category}</span>
                  </Link>
                </Button>
              ) : (
                <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs">
                  {product.category}
                </span>
              )}
            </div>
          </div>
        </div>

        {linked && (
          <div className="order-last flex flex-wrap justify-end gap-2 sm:order-none sm:flex-col sm:items-stretch sm:justify-start">
            {isOwner && (
              <Button
                size="sm"
                variant="outline"
                asChild
                className="relative z-10 rounded-full"
              >
                <a href="#">
                  <PencilIcon aria-hidden="true" />
                  <span className="sr-only">{product.name}を</span>
                  編集
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              asChild
              className="relative z-10 rounded-full"
            >
              <a href={product.siteUrl} target="_blank" rel={siteRel}>
                <span className="sr-only">{product.name}の</span>
                サイトを開く
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            </Button>
          </div>
        )}

        <div className="border-t border-border/70 pt-3 sm:col-span-2">
          <ol
            id={launchesId}
            aria-label={`${product.name}のローンチ履歴`}
            className="space-y-2"
          >
            {shown.map((launch) => (
              <LaunchRow
                key={launch.id}
                launch={launch}
                now={now}
                interactive={linked}
              />
            ))}
          </ol>
          {hidden > 0 && (
            <Button
              size="xs"
              variant="ghost"
              className="relative z-10 mt-2 -ml-2 text-muted-foreground"
              aria-expanded={expanded}
              aria-controls={launchesId}
              onClick={() => setExpanded((current) => !current)}
            >
              <ChevronDownIcon
                aria-hidden="true"
                className={cn('transition-transform', expanded && 'rotate-180')}
              />
              {expanded ? '折りたたむ' : `他${hidden}回を表示`}
            </Button>
          )}
        </div>
      </article>
    </li>
  );
}
