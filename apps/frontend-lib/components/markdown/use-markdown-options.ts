import { useRouter } from '@tanstack/react-router';

import type {
  LinkRelToken,
  MarkdownRenderOptions,
} from '../../../common-lib/markdown/markdown-options.ts';
import { appRuntimeOf } from '../../start/router-context.ts';

export interface MarkdownOptionsInput {
  readonly externalLinkRel: readonly LinkRelToken[];
  readonly sameOriginLinkRel?: readonly LinkRelToken[];
  readonly idScope?: string;
}

// 同じタブで開くリンクの判定は利用者側のページのオリジンで行うため、管理者側の画面でも利用者側のオリジンを使う
export function useMarkdownOptions({
  externalLinkRel,
  sameOriginLinkRel,
  idScope,
}: MarkdownOptionsInput): MarkdownRenderOptions {
  const router = useRouter();
  const siteOrigin = appRuntimeOf(router.options.context).publicConfig
    .clientSiteOrigin;
  return {
    siteOrigin,
    externalLinkRel,
    ...(sameOriginLinkRel === undefined ? {} : { sameOriginLinkRel }),
    ...(idScope === undefined ? {} : { idScope }),
  };
}
