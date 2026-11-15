import { ChevronDownIcon } from 'lucide-react';

import type {
  MarkdownHeading,
  MarkdownHeadingDepth,
} from '../../../common-lib/markdown/render-markdown.ts';
import { HELP_TABLE_OF_CONTENTS_LABEL } from './help-messages.ts';

export interface HelpTableOfContentsProps {
  readonly headings: readonly MarkdownHeading[];
}

const INDENT_CLASS_NAMES: Readonly<Record<MarkdownHeadingDepth, string>> = {
  2: '',
  3: 'pl-3',
  4: 'pl-6',
  5: 'pl-9',
  6: 'pl-12',
};

function HeadingLinks({ headings }: HelpTableOfContentsProps) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {headings.map((heading) => (
        <li
          key={heading.id}
          data-depth={heading.depth}
          className={INDENT_CLASS_NAMES[heading.depth]}
        >
          <a
            href={`#${heading.id}`}
            className="block rounded-md px-2 py-1 leading-snug wrap-anywhere text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground"
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

// PCとモバイルの両方を描き、CSSのブレークポイントで一方だけを表示する。サーバー側の描画とブラウザの初期化で表示が食い違わないため
export function HelpTableOfContents({ headings }: HelpTableOfContentsProps) {
  if (headings.length === 0) {
    return null;
  }

  return (
    <>
      <details className="group rounded-xl border border-border bg-card text-card-foreground lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
          {HELP_TABLE_OF_CONTENTS_LABEL}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="border-t border-border px-2 py-2">
          <HeadingLinks headings={headings} />
        </div>
      </details>
      <nav
        aria-label={HELP_TABLE_OF_CONTENTS_LABEL}
        className="hidden overscroll-contain lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
      >
        <p className="mb-2 px-2 text-xs font-bold tracking-wide text-muted-foreground">
          {HELP_TABLE_OF_CONTENTS_LABEL}
        </p>
        <HeadingLinks headings={headings} />
      </nav>
    </>
  );
}
