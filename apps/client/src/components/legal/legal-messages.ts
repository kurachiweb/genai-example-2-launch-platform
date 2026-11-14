import { legalVersionLabel } from '../../../common-lib/legal/legal-documents.ts';

export const LAST_REVISED_LABEL = '最終改訂日';

export const REVISION_HISTORY_TITLE = '改訂履歴';

export const LEGAL_DOCUMENT_PREPARING_MESSAGE = 'この文書は準備中です。';

export const PUBLISHED_AT_LABEL = '公開日';

export const CHANGE_SUMMARY_LABEL = '変更概要';

export const LATEST_VERSION_NOTICE = 'これは最新版です。';

export const VIEW_PUBLIC_PAGE_LABEL = '公開ページを見る';

export const VIEW_LATEST_VERSION_LABEL = '最新版を見る';

export const pastVersionNotice = (versionNumber: number): string =>
  `これは${legalVersionLabel(versionNumber)}です。最新版ではありません。`;
