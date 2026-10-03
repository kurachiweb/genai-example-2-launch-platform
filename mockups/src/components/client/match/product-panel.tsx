import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon, TrophyIcon } from 'lucide-react';

import { ProductLogoArt } from '#/components/client/art/product-logo-art';
import type { Side } from '#/components/client/stadium-pitch/stadium-pitch';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { categorySlugOf } from '#/lib/mock-data';
import type { Product } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { UpvoteButton } from './upvote-button';

type Props = {
  product: Product;
  linked: boolean;
  // 外部Webサイトへのリンクのrel属性(ページ構成の「外部Webサイトへのリンク」の表に従う)
  siteRel: string;
  side: Side;
  votes: number;
  pressed: boolean;
  disabledReason: string | null;
  onUpvote: () => void;
  winnerLabel: string | null;
  isLoser: boolean;
  isFinal: boolean;
};

export function ProductPanel({
  product,
  linked,
  siteRel,
  side,
  votes,
  pressed,
  disabledReason,
  onUpvote,
  winnerLabel,
  isLoser,
  isFinal,
}: Props) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-xl border bg-card/80 p-3 shadow-sm backdrop-blur-sm',
        side === 'right' && '@[768px]:flex-row-reverse @[768px]:text-right',
        winnerLabel && 'border-gold ring-2 ring-gold/50',
        isLoser && 'border-border/60 text-defeat',
        isFinal && 'rounded-2xl p-4 @[768px]:p-3 @[1200px]:p-5',
      )}
    >
      <ProductLogoArt
        palette={product.art.palette}
        variant={product.art.variant}
        size={isFinal ? 64 : 48}
        title={product.name}
        className={cn(
          isFinal ? 'rounded-lg shadow-lg' : 'rounded-lg',
          isLoser && 'opacity-70 saturate-50',
        )}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5',
            side === 'right' && '@[768px]:justify-end',
          )}
        >
          {winnerLabel && (
            <Badge
              size="lg"
              className="gold-gradient border-0 text-gold-foreground"
            >
              <TrophyIcon aria-hidden="true" />
              {winnerLabel}
            </Badge>
          )}
          <Button size="xs" variant="outline" asChild className="rounded-full">
            <Link
              to="/client/p"
              search={{ category: categorySlugOf(product.category) }}
            >
              {product.category}
            </Link>
          </Button>
        </div>
        <h3
          className={cn(
            'mt-1 font-extrabold tracking-tight wrap-anywhere',
            isFinal
              ? 'text-2xl @[768px]:text-lg @[1200px]:text-3xl'
              : 'text-base @[768px]:text-lg',
          )}
        >
          {linked ? (
            <Link
              to="/client/p/$handle"
              params={{ handle: product.handle }}
              className="text-inherit no-underline hover:underline focus-visible:rounded focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {product.name}
            </Link>
          ) : (
            product.name
          )}
        </h3>
        <p
          className={cn(
            'line-clamp-2 text-muted-foreground',
            isFinal
              ? 'text-sm @[1200px]:text-base'
              : 'text-xs @[768px]:text-sm',
          )}
        >
          {product.tagline}
        </p>
        <div
          className={cn(
            'mt-2 flex',
            side === 'right' && '@[768px]:justify-end',
          )}
        >
          <Button size="xs" variant="outline" asChild className="rounded-full">
            <a
              href={product.siteUrl}
              target="_blank"
              rel={siteRel}
              className="px-4"
            >
              サイトを開く
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
      <UpvoteButton
        count={votes}
        pressed={pressed}
        disabledReason={disabledReason}
        productName={product.name}
        variant={isFinal ? 'final' : 'card'}
        onClick={onUpvote}
      />
    </div>
  );
}
