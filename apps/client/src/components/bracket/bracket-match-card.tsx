import { PackageIcon } from 'lucide-react';
import { useId } from 'react';

import { NumberText } from '../../../lib/components/datetime/number-text.tsx';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { HIDDEN_PRODUCT_NAME } from '../match/match-labels.ts';
import { ProductNameLink } from '../match/product-name-link.tsx';
import {
  BRACKET_MATCH_STATUS_LABELS,
  BRACKET_NO_OPPONENT_LABEL,
  BRACKET_SLOT_OUTCOME_LABELS,
  BRACKET_UPVOTE_COUNT_LABEL,
  BRACKET_VERSUS_LABEL,
  bracketDrawNumberLabel,
  bracketMatchHeading,
  bracketSeedLabel,
} from './bracket-messages.ts';
import {
  type BracketSlotDisplay,
  type BracketSlotOutcome,
  matchStatusOf,
  slotDisplayOf,
  slotOutcomeOf,
} from './bracket-view-model.ts';
import type { BracketViewNode, BracketViewSlot } from './bracket-view-props.ts';

export interface BracketMatchCardProps {
  readonly roundName: string;
  readonly node: BracketViewNode;
}

const PLACEHOLDER_TEXT = 'text-sm text-muted-foreground';

function SlotBody({ display }: { readonly display: BracketSlotDisplay }) {
  switch (display.kind) {
    case 'feed':
      return <span className={PLACEHOLDER_TEXT}>{display.label}</span>;
    case 'empty':
      return (
        <span className={PLACEHOLDER_TEXT}>{BRACKET_NO_OPPONENT_LABEL}</span>
      );
    case 'number':
      return (
        <span className={PLACEHOLDER_TEXT}>
          {bracketDrawNumberLabel(display.participantNo)}
        </span>
      );
    case 'hidden':
      return (
        <>
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <PackageIcon className="size-4" />
          </span>
          <span className="min-w-0 text-sm font-semibold text-muted-foreground">
            {HIDDEN_PRODUCT_NAME}
          </span>
        </>
      );
    case 'product':
      return (
        <>
          <MediaPicture
            image={display.product.logo}
            display={{ kind: 'square', size: 32 }}
            alt=""
            placeholder={{
              label: display.product.name,
              seed: display.product.handle,
            }}
            loading="lazy"
            className="size-8 shrink-0 rounded-lg"
          />
          <span className="min-w-0 text-sm font-bold wrap-anywhere text-foreground">
            <ProductNameLink
              name={display.product.name}
              handle={display.product.handle}
              linked={display.product.listed}
            />
          </span>
        </>
      );
  }
}

function OutcomeBadge({ outcome }: { readonly outcome: BracketSlotOutcome }) {
  const won = outcome === 'won' || outcome === 'bye';
  return (
    <Badge
      variant={won ? 'default' : 'outline'}
      className={cn(won && 'border-0 bg-gold text-gold-foreground')}
    >
      {BRACKET_SLOT_OUTCOME_LABELS[outcome]}
    </Badge>
  );
}

function BracketSide({
  node,
  slot,
  second,
}: {
  readonly node: BracketViewNode;
  readonly slot: BracketViewSlot;
  readonly second: boolean;
}) {
  const display = slotDisplayOf(node, slot);
  const outcome = slotOutcomeOf(node, slot);
  // 未来の枠の表記がシードを示すため、表記の無い枠だけシードの番号を添える
  const seed = display.kind === 'feed' ? null : slot.seed;
  return (
    <li className="flex flex-col gap-1">
      {second && (
        <span className="text-xs font-semibold text-muted-foreground">
          {BRACKET_VERSUS_LABEL}
        </span>
      )}
      <div
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-lg border border-border px-2 py-1.5',
          outcome === 'won' && 'border-gold',
          (outcome === 'lost' || outcome === 'both-lost') && 'border-dashed',
        )}
      >
        {seed !== null && (
          <Badge variant="outline" className="shrink-0">
            {bracketSeedLabel(seed)}
          </Badge>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <SlotBody display={display} />
        </span>
        {slot.upvoteCount !== null && (
          <span className="shrink-0 text-sm font-extrabold tabular-nums">
            <span className="sr-only">{BRACKET_UPVOTE_COUNT_LABEL}</span>
            <NumberText value={slot.upvoteCount} />
          </span>
        )}
        {outcome !== null && <OutcomeBadge outcome={outcome} />}
      </div>
    </li>
  );
}

export function BracketMatchCard({ roundName, node }: BracketMatchCardProps) {
  const headingId = useId();
  const status = matchStatusOf(node);
  const [first, second] = node.slots;
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-bold">
          {bracketMatchHeading(roundName, node.position)}
        </h3>
        <Badge variant={status === 'live' ? 'destructive' : 'outline'}>
          {BRACKET_MATCH_STATUS_LABELS[status]}
        </Badge>
      </header>
      <ul className="flex flex-col gap-1">
        {first !== undefined && (
          <BracketSide node={node} slot={first} second={false} />
        )}
        {second !== undefined && (
          <BracketSide node={node} slot={second} second />
        )}
      </ul>
    </article>
  );
}
