import { PackageIcon, TrophyIcon } from 'lucide-react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import type { MatchByeFragment } from '../../graphql/generated/graphql.ts';
import {
  BYE_BADGE_LABEL,
  byeCardLabel,
  byeDescriptionOf,
} from './bye-messages.ts';
import { siteRelOf } from './match-card-model.ts';
import { HIDDEN_PRODUCT_NAME } from './match-labels.ts';
import { ProductNameLink } from './product-name-link.tsx';
import { ProductSiteLink } from './product-site-link.tsx';

export interface ByeCardProps {
  readonly bye: MatchByeFragment;
  readonly className?: string;
}

const NAME_CLASS = 'mt-1 text-base font-bold wrap-anywhere';

export function ByeCard({ bye, className }: ByeCardProps) {
  const preferences = useDisplayPreferences();
  const { match, entry } = bye;
  const { product } = entry;
  const description = byeDescriptionOf({
    kind: match.kind,
    endedEarly: match.endedEarly,
    upvoteCount: formatNumber(entry.upvoteCount, preferences),
  });
  return (
    <article
      aria-label={byeCardLabel(product?.name ?? HIDDEN_PRODUCT_NAME)}
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-gold/60 bg-card p-3 text-card-foreground shadow-sm',
        className,
      )}
    >
      {product === null ? (
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <PackageIcon className="size-6" />
        </span>
      ) : (
        <MediaPicture
          image={product.logo}
          display={{ kind: 'square', size: 64 }}
          alt=""
          placeholder={{ label: product.name, seed: product.handle }}
          loading="lazy"
          className="size-12 shrink-0 rounded-lg"
        />
      )}
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="border-0 bg-gold text-gold-foreground">
            <TrophyIcon aria-hidden="true" />
            {BYE_BADGE_LABEL}
          </Badge>
          {product === null ? null : (
            <Badge variant="outline">{product.category.name}</Badge>
          )}
        </div>
        {product === null ? (
          <h4 className={cn(NAME_CLASS, 'text-muted-foreground')}>
            {HIDDEN_PRODUCT_NAME}
          </h4>
        ) : (
          <>
            <h4 className={NAME_CLASS}>
              <ProductNameLink
                name={product.name}
                handle={product.handle}
                linked={product.listed || entry.isViewerOwn}
              />
            </h4>
            <p className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
              {product.tagline}
            </p>
          </>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {product === null ? null : (
        <ProductSiteLink
          name={product.name}
          websiteUrl={product.websiteUrl}
          rel={siteRelOf(match.kind)}
        />
      )}
    </article>
  );
}
