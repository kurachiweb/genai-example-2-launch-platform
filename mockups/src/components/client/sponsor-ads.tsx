import { useEffect, useState } from 'react';
import { ExternalLinkIcon, MegaphoneIcon } from 'lucide-react';

import { ProductLogoArt } from '#/components/client/art';
import { Button } from '#/components/ui/button';
import type { Product, User } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

export type SponsorTier = 'legend' | 'gold' | 'silver';

export type SponsorAd = {
  id: string;
  tier: SponsorTier;
  product: Product;
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 同一ティア内は表示毎にランダムな並びにする(FR-SPONS-007)。SSRと初回描画の一致のため並び替えはマウント後に行う
export function useShuffledAds(ads: SponsorAd[]) {
  const [ordered, setOrdered] = useState(ads);
  useEffect(() => {
    setOrdered(shuffle(ads));
  }, [ads]);
  return ordered;
}

function SponsorLabel({
  tier,
  className,
}: {
  tier: SponsorTier;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
        tier === 'legend' && 'legend-gradient shimmer text-white',
        tier === 'gold' && 'gold-gradient text-gold-foreground',
        tier === 'silver' && 'bg-silver text-[oklch(0.25_0.01_250)]',
        className,
      )}
    >
      {tier === 'legend' ? 'レジェンドスポンサー' : 'スポンサー'}
    </span>
  );
}

export function LegendBanner({ ads }: { ads: SponsorAd[] }) {
  const ordered = useShuffledAds(ads);
  if (ordered.length === 0) return null;
  return (
    <ul className="contents" aria-label="Legendスポンサー広告">
      {ordered.map((ad) => (
        <li
          key={ad.id}
          className="legend-frame shimmer relative flex items-center gap-2 rounded-xl p-2 pt-1.5 shadow-sm sm:gap-3 sm:p-3 sm:pt-2.5"
        >
          <ProductLogoArt
            palette={ad.product.art.palette}
            variant={ad.product.art.variant}
            size={56}
            title={ad.product.name}
            className="rounded-lg shadow-md max-sm:h-11 max-sm:w-11"
          />
          <div className="min-w-0 flex-1">
            <SponsorLabel tier="legend" />
            <p className="mt-1 text-sm font-extrabold wrap-anywhere">
              {ad.product.name}
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {ad.product.tagline}
            </p>
          </div>
          <a
            href={ad.product.siteUrl}
            rel="sponsored noopener"
            target="_blank"
            className="absolute inset-0 rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={`${ad.product.name}のサイトを別タブで開く(スポンサー広告)`}
          />
        </li>
      ))}
    </ul>
  );
}

export function GoldCard({ ad }: { ad: SponsorAd }) {
  return (
    <div className="relative flex items-center gap-3 rounded-xl border border-gold/50 bg-card p-3 pt-2.5 shadow-sm">
      <ProductLogoArt
        palette={ad.product.art.palette}
        variant={ad.product.art.variant}
        size={64}
        title={ad.product.name}
      />
      <div className="min-w-0 flex-1">
        <SponsorLabel tier="gold" />
        <p className="mt-1 font-bold wrap-anywhere">{ad.product.name}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {ad.product.tagline}
        </p>
      </div>
      <a
        href={ad.product.siteUrl}
        rel="sponsored noopener"
        target="_blank"
        className="absolute inset-0 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`${ad.product.name}のサイトを別タブで開く(スポンサー広告)`}
      />
    </div>
  );
}

export function SponsorJoinCard() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-gold/60 bg-gold/5 p-3">
      <p className="font-bold">あなたのプロダクトを宣伝します</p>
      <p className="text-xs text-muted-foreground">
        Goldスポンサーは$8/日から。掲載期間は1日単位で選べます。
      </p>
      <Button size="sm" variant="outline" className="self-start" asChild>
        <a href="#">
          <MegaphoneIcon aria-hidden="true" />
          スポンサー広告を申し込む
        </a>
      </Button>
    </div>
  );
}

export function GoldSidebar({
  ads,
  user,
}: {
  ads: SponsorAd[];
  user: User | null;
}) {
  const ordered = useShuffledAds(ads);
  return (
    <aside
      aria-label="Goldスポンサー広告"
      className="hidden w-70 shrink-0 lg:block"
    >
      <div className="sticky top-20 space-y-3">
        {ordered.map((ad) => (
          <GoldCard key={ad.id} ad={ad} />
        ))}
        {user && <SponsorJoinCard />}
      </div>
    </aside>
  );
}

function SilverJoinPill() {
  return (
    <a
      href="#"
      className="flex items-center gap-2 rounded-full border border-dashed border-silver bg-silver/10 py-1 pr-3 pl-1 text-sm font-medium text-foreground no-underline hover:bg-accent"
    >
      <span
        className="flex size-7 items-center justify-center rounded-full bg-silver/40"
        aria-hidden="true"
      >
        <MegaphoneIcon className="size-4" />
      </span>
      $5/日でSilverスポンサーになる
    </a>
  );
}

export function SilverList({
  ads,
  user,
}: {
  ads: SponsorAd[];
  user: User | null;
}) {
  const ordered = useShuffledAds(ads);
  if (ordered.length === 0 && !user) return null;
  return (
    <section
      aria-label="Silverスポンサー広告"
      className="mx-auto w-full max-w-7xl px-4 pt-12"
    >
      <div className="mb-2 flex items-center gap-2">
        <SponsorLabel tier="silver" />
      </div>
      <ul className="flex flex-wrap gap-2">
        {ordered.map((ad) => (
          <li key={ad.id}>
            <a
              href={ad.product.siteUrl}
              rel="sponsored noopener"
              target="_blank"
              className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pr-3 pl-1 text-sm font-medium text-foreground no-underline hover:border-silver hover:bg-accent"
            >
              <ProductLogoArt
                palette={ad.product.art.palette}
                variant={ad.product.art.variant}
                size={28}
                title={ad.product.name}
                className="rounded-full"
              />
              <span className="max-w-48 wrap-anywhere">{ad.product.name}</span>
              <ExternalLinkIcon
                className="size-3 text-muted-foreground"
                aria-hidden="true"
              />
            </a>
          </li>
        ))}
        {user && (
          <li>
            <SilverJoinPill />
          </li>
        )}
      </ul>
    </section>
  );
}
