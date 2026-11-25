import { PackageIcon, TrophyIcon } from 'lucide-react';
import { useId } from 'react';

import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { HIDDEN_PRODUCT_NAME } from '../match/match-labels.ts';
import { ProductNameLink } from '../match/product-name-link.tsx';
import { BRACKET_NO_AWARD_LABEL } from './bracket-messages.ts';
import { championStateOf } from './bracket-view-model.ts';
import type { BracketViewProps } from './bracket-view-props.ts';

export interface BracketChampionProps extends Pick<
  BracketViewProps,
  'champion' | 'awarded' | 'finished'
> {
  // 賞の名前(「Product of the Week」など)。トーナメントの種類ごとに呼び出し元が渡す
  readonly awardName: string;
}

function ChampionProduct({
  product,
}: {
  readonly product: NonNullable<BracketViewProps['champion']>;
}) {
  return (
    <p className="flex min-w-0 items-center gap-3">
      <MediaPicture
        image={product.logo}
        display={{ kind: 'square', size: 64 }}
        alt=""
        placeholder={{ label: product.name, seed: product.handle }}
        className="size-14 shrink-0 rounded-xl"
      />
      <span className="min-w-0 text-xl font-extrabold tracking-tight wrap-anywhere">
        <ProductNameLink
          name={product.name}
          handle={product.handle}
          linked={product.listed}
        />
      </span>
    </p>
  );
}

function HiddenChampion() {
  return (
    <p className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
      >
        <PackageIcon className="size-7" />
      </span>
      <span className="text-xl font-extrabold tracking-tight text-muted-foreground">
        {HIDDEN_PRODUCT_NAME}
      </span>
    </p>
  );
}

export function BracketChampion({ awardName, ...view }: BracketChampionProps) {
  const headingId = useId();
  const state = championStateOf(view);
  if (state === null) {
    return null;
  }
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-2xl border border-gold bg-card p-4 text-card-foreground shadow-sm"
    >
      <h2
        id={headingId}
        translate="no"
        className="flex w-fit items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-sm font-bold text-gold-foreground"
      >
        <TrophyIcon className="size-4" aria-hidden="true" />
        {awardName}
      </h2>
      {state.kind === 'no-award' ? (
        <p className="text-base font-semibold text-muted-foreground">
          {BRACKET_NO_AWARD_LABEL}
        </p>
      ) : state.product === null ? (
        <HiddenChampion />
      ) : (
        <ChampionProduct product={state.product} />
      )}
    </section>
  );
}
