import { useId } from 'react';
import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon, MessageSquareIcon, PencilIcon } from 'lucide-react';

import { ProductLogo } from '#/components/client/product-logo';
import { UserAvatar } from '#/components/client/user-avatar';
import { Button } from '#/components/ui/button';

import type { DirectoryEntry } from '../-model/listing';
import { AwardBadges } from './award-badges';
import { HighlightedText } from './highlighted-text';
import { WinSummary } from './win-summary';
import { useDirectoryFormat } from './use-directory-format';

type Props = {
  entry: DirectoryEntry;
  query: string | undefined;
  imagesBroken: boolean;
};

// 名称のリンクを項目全体に広げ(stretched link)、内側のボタン・リンクはz-10で前面に出して個別に操作できるようにする
export function ProductItem({ entry, query, imagesBroken }: Props) {
  const nameId = useId();
  const format = useDirectoryFormat();
  const { product, category, maker, isOwn, awards, commentCount, win } = entry;

  return (
    <li>
      <article
        aria-labelledby={nameId}
        className="group relative grid gap-4 rounded-2xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30 sm:grid-cols-[minmax(0,1fr)_15rem] sm:p-5 lg:grid-cols-[minmax(0,1fr)_15rem_auto] lg:items-center lg:gap-5"
      >
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <ProductLogo
            product={product}
            size={64}
            broken={imagesBroken}
            className="size-14 rounded-xl shadow-sm sm:size-16"
          />
          <div className="min-w-0 flex-1">
            {awards.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                <AwardBadges awards={awards} />
              </div>
            )}
            <h3
              id={nameId}
              className="text-lg leading-snug font-extrabold tracking-tight wrap-anywhere"
            >
              <Link
                to="/client/p/$handle"
                params={{ handle: product.handle }}
                className="text-foreground no-underline group-hover:underline after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
              >
                <HighlightedText text={product.name} query={query} />
              </Link>
            </h3>
            <p className="mt-1 line-clamp-2 text-sm wrap-anywhere text-muted-foreground">
              <HighlightedText text={product.tagline} query={query} />
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <Button
                size="xs"
                variant="outline"
                asChild
                className="relative z-10 h-auto min-h-6 max-w-full rounded-full py-0.5 whitespace-normal"
              >
                <Link
                  from="/client/p/"
                  to="/client/p"
                  search={(prev) => ({
                    ...prev,
                    category: category.slug,
                    page: undefined,
                  })}
                  aria-label={`カテゴリ「${category.name}」で絞り込む`}
                >
                  <span className="wrap-anywhere">{category.name}</span>
                </Link>
              </Button>
              {isOwn ? (
                <span className="rounded-full bg-primary/12 px-2.5 py-0.5 font-bold text-primary">
                  あなたのプロダクト
                </span>
              ) : (
                <a
                  href="#"
                  className="relative z-10 inline-flex min-w-0 items-center gap-1.5 text-muted-foreground no-underline hover:text-foreground hover:underline"
                >
                  <UserAvatar user={maker} size={20} broken={imagesBroken} />
                  <span className="sr-only">投稿者: </span>
                  <span className="min-w-0 wrap-anywhere">
                    {maker.nickname}
                  </span>
                </a>
              )}
              <Link
                to="/client/p/$handle"
                params={{ handle: product.handle }}
                hash="history-heading"
                className="relative z-10 inline-flex items-center gap-1 text-muted-foreground no-underline hover:text-foreground hover:underline"
              >
                <MessageSquareIcon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">コメント</span>
                <span className="tabular-nums">
                  {format.number(commentCount)}
                </span>
                <span className="sr-only">件</span>
              </Link>
            </div>
          </div>
        </div>

        <WinSummary win={win} />
        <div className="flex flex-wrap justify-end gap-2 sm:col-start-2 lg:col-start-auto lg:flex-col lg:items-stretch">
          {isOwn && (
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
            <a href={product.siteUrl} target="_blank" rel="noopener">
              <span className="sr-only">{product.name}の</span>
              サイトを開く
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
        </div>
      </article>
    </li>
  );
}
