import { LEGAL_DOCUMENT_LABELS } from '../../common-lib/legal/legal-documents.ts';
import { buildPageHead } from '../../lib/start/page-head.ts';
import { ADMIN_SITE_NAME } from '../components/layout/admin-site.ts';
import {
  LEGAL_DOCUMENTS_TITLE,
  legalVersionTitle,
} from '../components/legal/legal-documents-messages.ts';
import type {
  LegalDocumentLoaderData,
  LegalVersionLoaderData,
} from '../graphql/admin-legal-documents.ts';

export interface RootHeadInput {
  readonly stylesheetHref: string;
}

export interface AdminPageHeadInput {
  readonly title: string;
  readonly noIndex?: boolean;
}

// TanStack Routerのheadは書き換え可能な配列を求めるため、凍結された配列を広げて新しい配列で返す
export const buildAdminPageHead = ({ title, noIndex }: AdminPageHeadInput) => {
  const head = buildPageHead({
    title,
    siteName: ADMIN_SITE_NAME,
    ...(noIndex === undefined ? {} : { noIndex }),
  });
  return { meta: [...head.meta], links: [...head.links] };
};

// 配色の初回描画前のスクリプトはAppDocumentが置き、管理者側はアクセス解析を組み込まないため、headにスクリプトを置かない
export const buildRootHead = ({ stylesheetHref }: RootHeadInput) => ({
  meta: [
    { charSet: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ...buildAdminPageHead({ title: '' }).meta,
  ],
  links: [{ rel: 'stylesheet', href: stylesheetHref }],
});

// 存在しないページと取得の失敗ではloaderのデータが無いため、画面の区分の名前をタイトルにする
export const buildLegalDocumentEditorHead = (
  loaderData: LegalDocumentLoaderData | undefined,
) =>
  buildAdminPageHead({
    title:
      loaderData === undefined
        ? LEGAL_DOCUMENTS_TITLE
        : LEGAL_DOCUMENT_LABELS[loaderData.kind],
  });

export const buildLegalDocumentVersionHead = (
  loaderData: LegalVersionLoaderData | undefined,
) =>
  buildAdminPageHead({
    title:
      loaderData === undefined
        ? LEGAL_DOCUMENTS_TITLE
        : legalVersionTitle(
            LEGAL_DOCUMENT_LABELS[loaderData.kind],
            loaderData.versionNumber,
          ),
  });
