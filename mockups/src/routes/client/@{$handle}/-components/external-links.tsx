import { ExternalLinkIcon, GlobeIcon } from 'lucide-react';

import type { ExternalLink } from '../-model/content';

type Props = { links: ExternalLink[] };

// 入力の自由度が高いため、ページ構成の「外部Webサイトへのリンク」に従いrelにugcを付ける(FR-UPROF-009)
const EXTERNAL_REL = 'noopener ugc';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ExternalLinks({ links }: Props) {
  return (
    <ul aria-label="外部Webサイト" className="-mx-2 space-y-1">
      {links.map((link) => {
        const host = hostOf(link.url);
        return (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel={EXTERNAL_REL}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-foreground no-underline hover:bg-accent"
            >
              <GlobeIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold wrap-anywhere group-hover:underline">
                  {link.name || host}
                </span>
                {link.name && (
                  <span className="block text-xs wrap-anywhere text-muted-foreground">
                    {host}
                  </span>
                )}
              </span>
              <ExternalLinkIcon
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="sr-only">(新しいタブで開きます)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
