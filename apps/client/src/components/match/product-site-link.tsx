import { ExternalLinkIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { checkExternalUrl } from '../../../common-lib/url/external-url.ts';
import {
  OPEN_SITE_LABEL,
  openSiteLabelPrefix,
} from '../launch-history/launch-history-messages.ts';
import { NEW_TAB_NOTICE } from '../profile/profile-messages.ts';

export interface ProductSiteLinkProps {
  readonly name: string;
  readonly websiteUrl: string;
  // 外部Webサイトへのリンクのrel。表示場所ごとの値はページ構成の「外部Webサイトへのリンク」に従う
  readonly rel: string;
}

export function ProductSiteLink({
  name,
  websiteUrl,
  rel,
}: ProductSiteLinkProps) {
  // 保存時の検証を通った値だけが入る前提だが、危険なスキームのリンクを作らないよう描画でも確かめる
  if (checkExternalUrl(websiteUrl) !== 'ok') {
    return null;
  }
  return (
    <Button asChild size="xs" variant="outline" className="rounded-full px-3">
      <a href={websiteUrl} target="_blank" rel={rel}>
        <span className="sr-only">{openSiteLabelPrefix(name)}</span>
        {OPEN_SITE_LABEL}
        <ExternalLinkIcon aria-hidden="true" />
        <span className="sr-only">{NEW_TAB_NOTICE}</span>
      </a>
    </Button>
  );
}
