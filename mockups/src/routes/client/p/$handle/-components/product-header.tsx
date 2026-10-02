import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon, LinkIcon, TrophyIcon } from 'lucide-react';
import { toast } from 'sonner';

import { ProductLogo } from '#/components/client/product-logo';
import { UserAvatar } from '#/components/client/user-avatar';
import { Button } from '#/components/ui/button';
import { useDateTimeFormatter } from '#/lib/date-format';
import { categorySlugOf } from '#/lib/mock-data';
import type { Product, User } from '#/lib/mock-data';

import { isoDate } from '../-model/clock';
import type { ProductRecord } from '../-model/page-model';
import { FollowButton } from './follow-button';
import { usePageContext } from './page-context';

type Props = {
  product: Product;
  maker: User;
  record: ProductRecord;
  awardCount: number;
};

export function ProductHeader({ product, maker, record, awardCount }: Props) {
  const { imagesBroken } = usePageContext();
  const dateFormatter = useDateTimeFormatter('longDate');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('リンクをコピーしました。');
    } catch {
      toast.error('リンクをコピーできませんでした。');
    }
  };

  return (
    <section
      aria-labelledby="product-name"
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7"
    >
      <div className="flex items-start gap-4 sm:gap-6">
        <ProductLogo
          product={product}
          size={128}
          broken={imagesBroken}
          className="size-20 rounded-2xl shadow-md sm:size-32"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              asChild
              className="rounded-full"
            >
              <Link
                to="/client/p"
                search={{ category: categorySlugOf(product.category) }}
              >
                {product.category}
              </Link>
            </Button>
            {awardCount > 0 && (
              <a
                href="#trophies"
                className="gold-gradient inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-gold-foreground no-underline"
              >
                <TrophyIcon className="size-3.5" aria-hidden="true" />
                受賞{awardCount}回
              </a>
            )}
          </div>
          <h1
            id="product-name"
            className="mt-2 text-2xl leading-tight font-extrabold tracking-tight text-balance wrap-anywhere sm:text-4xl"
          >
            {product.name}
          </h1>
          <p className="mt-2 text-base wrap-anywhere text-muted-foreground sm:text-lg">
            {product.tagline}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-border pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar user={maker} size={40} broken={imagesBroken} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">投稿者</p>
            <a
              href="#"
              className="block font-bold wrap-anywhere text-foreground no-underline hover:underline"
            >
              {maker.nickname}
            </a>
            <p className="text-xs wrap-anywhere text-muted-foreground">
              @{maker.handle}
            </p>
          </div>
          <FollowButton maker={maker} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            aria-label="リンクをコピー"
            title="リンクをコピー"
            onClick={copyLink}
          >
            <LinkIcon aria-hidden="true" />
          </Button>
          <Button size="lg" asChild>
            <a href={product.siteUrl} target="_blank" rel="noopener">
              サイトを開く
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>

      {record.firstLaunch && (
        <dl className="mt-5 grid grid-cols-3 divide-x divide-border rounded-xl bg-muted/60 text-center">
          <div className="px-2 py-2.5">
            <dt className="text-xs text-muted-foreground">初ローンチ</dt>
            <dd className="mt-0.5 text-sm font-bold">
              <time dateTime={isoDate(record.firstLaunch)}>
                {dateFormatter.format(record.firstLaunch)}
              </time>
            </dd>
          </div>
          <div className="px-2 py-2.5">
            <dt className="text-xs text-muted-foreground">ローンチ</dt>
            <dd className="scoreboard-digits mt-0.5 text-lg">
              {record.launchCount}
              <span className="text-xs font-bold">回</span>
            </dd>
          </div>
          <div className="px-2 py-2.5">
            <dt className="text-xs text-muted-foreground">通算成績</dt>
            <dd className="scoreboard-digits mt-0.5 text-lg">
              {record.wins}
              <span className="text-xs font-bold">勝</span>
              {record.losses}
              <span className="text-xs font-bold">敗</span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
