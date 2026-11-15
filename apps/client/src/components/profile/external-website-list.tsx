import { ExternalLinkIcon, GlobeIcon } from 'lucide-react';

import {
  checkExternalUrl,
  externalUrlHost,
} from '../../../common-lib/url/external-url.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { NEW_TAB_NOTICE, PROFILE_WEBSITES_LABEL } from './profile-messages.ts';
import type { PublicProfileWebsiteView } from './public-profile-view.ts';

export interface ExternalWebsiteListProps {
  readonly websites: readonly PublicProfileWebsiteView[];
}

// 利用者の入力のリンクのため、検索エンジンへ評価を渡さないugcと、開いた先から元のページを操作させないnoopenerを付ける
const WEBSITE_LINK_REL = 'noopener ugc';

interface LinkableWebsite {
  readonly key: string;
  readonly url: string;
  readonly host: string;
  readonly name: string;
}

// 保存時の検証を通った値だけが入る前提だが、危険なスキームのリンクを作らないよう描画でも確かめる
const linkableWebsitesOf = (
  websites: readonly PublicProfileWebsiteView[],
): readonly LinkableWebsite[] => {
  const occurrences = new Map<string, number>();
  return websites.flatMap((website) => {
    const url = trimWhiteSpace(website.url);
    if (checkExternalUrl(url) !== 'ok') {
      return [];
    }
    const host = externalUrlHost(url);
    const occurrence = occurrences.get(url) ?? 0;
    occurrences.set(url, occurrence + 1);
    const key = occurrence === 0 ? url : `${url}#${occurrence.toString()}`;
    return [{ key, url, host, name: trimWhiteSpace(website.name ?? '') }];
  });
};

export function ExternalWebsiteList({ websites }: ExternalWebsiteListProps) {
  const links = linkableWebsitesOf(websites);
  if (links.length === 0) {
    return null;
  }
  return (
    <div
      data-slot="profile-websites"
      className="mt-5 border-t border-border pt-4"
    >
      <ul aria-label={PROFILE_WEBSITES_LABEL} className="-mx-2 space-y-1">
        {links.map(({ key, url, host, name }) => (
          <li key={key}>
            <a
              href={url}
              target="_blank"
              rel={WEBSITE_LINK_REL}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-foreground no-underline hover:bg-accent"
            >
              <GlobeIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold wrap-anywhere group-hover:underline">
                  {name === '' ? host : name}
                </span>
                {name !== '' && (
                  <span className="block text-xs wrap-anywhere text-muted-foreground">
                    {host}
                  </span>
                )}
              </span>
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="sr-only">{NEW_TAB_NOTICE}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
