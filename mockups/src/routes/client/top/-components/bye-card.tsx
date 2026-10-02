import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon, TrophyIcon } from 'lucide-react';

import { ProductLogoArt } from '#/components/client/art/product-logo-art';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';

import type { ByeEntry } from '../-model';

type Props = {
  entry: ByeEntry;
};

export function ByeCard({ entry }: Props) {
  const { product } = entry;
  return (
    <article
      aria-label={`${product.name}(不戦勝)`}
      className="rise-in flex items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-card/80 p-3"
    >
      <ProductLogoArt
        palette={product.art.palette}
        variant={product.art.variant}
        size={48}
        title={product.name}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            size="lg"
            className="gold-gradient border-0 text-gold-foreground"
          >
            <TrophyIcon aria-hidden="true" />
            不戦勝
          </Badge>
          <Badge variant="secondary" size="lg">
            {product.category}
          </Badge>
        </div>
        <h3 className="mt-1 font-bold wrap-anywhere">
          <Link
            to="/client/p/$handle"
            params={{ handle: product.handle }}
            className="text-inherit no-underline hover:underline"
          >
            {product.name}
          </Link>
        </h3>
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {product.tagline}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {entry.reason === 'early'
            ? `対戦相手が不在になったためマッチ終了。${entry.votes}票のUpvoteで確定し、不戦勝でディレクトリに掲載されます。`
            : '対戦相手不在のため不戦勝。ディレクトリに掲載されます。'}
        </p>
      </div>
      <Button size="xs" variant="outline" asChild className="rounded-full">
        <a
          href={product.siteUrl}
          target="_blank"
          rel={entry.kind === 'qualifier' ? 'noopener ugc' : 'noopener'}
        >
          サイトを開く
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      </Button>
    </article>
  );
}
