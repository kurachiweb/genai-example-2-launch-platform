import { Link } from '@tanstack/react-router';
import { PinIcon } from 'lucide-react';

import { HighlightedText } from '../../../lib/components/search/highlighted-text.tsx';
import { HELP_PINNED_LABEL } from './help-messages.ts';

export interface HelpArticleLinkItemArticle {
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly pinned?: boolean;
}

export interface HelpArticleLinkItemProps {
  readonly article: HelpArticleLinkItemArticle;
  // 検索結果ではタイトルとサブタイトルの一致した部分を強調する
  readonly terms?: readonly string[];
  // 検索結果ではカテゴリ別に並ばないため、所属するカテゴリ名を添える
  readonly categoryName?: string;
}

const NO_TERMS: readonly string[] = Object.freeze([]);

export function HelpArticleLinkItem({
  article: { handle, title, subtitle, pinned = false },
  terms = NO_TERMS,
  categoryName,
}: HelpArticleLinkItemProps) {
  return (
    <li>
      <Link
        to="/help/$handle"
        params={{ handle }}
        className="group flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground no-underline shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30"
      >
        <span className="flex items-start gap-2 leading-snug font-bold wrap-anywhere">
          {pinned ? (
            <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-primary/12 p-1 text-primary">
              <PinIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{HELP_PINNED_LABEL}</span>
            </span>
          ) : null}
          <span className="group-hover:underline">
            <HighlightedText text={title} terms={terms} />
          </span>
        </span>
        <span className="text-sm wrap-anywhere text-muted-foreground">
          <HighlightedText text={subtitle} terms={terms} />
        </span>
        {categoryName === undefined ? null : (
          <span className="mt-1 w-fit rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {categoryName}
          </span>
        )}
      </Link>
    </li>
  );
}
