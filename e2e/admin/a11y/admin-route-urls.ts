import { QUARANTINE_REASONS } from '../../../apps/common-lib/moderation/moderation-labels.ts';
import type { LegalDocumentKind } from '../../../apps/common-lib/legal/legal-documents.ts';

const query = (name: string, value: string): string =>
  `?${new URLSearchParams({ [name]: value }).toString()}`;

// 利用者・プロダクトの一覧は他のテストのデータで長くならないよう、用意した対象で絞り込む
export const usersByEmailPath = (email: string): string =>
  `/users${query('email', email)}`;

export const productsByHandlePath = (handle: string): string =>
  `/products${query('handle', handle)}`;

export const commentsOfProductPath = (handle: string): string =>
  `/comments${query('productHandle', handle)}`;

export const ratingsOfProductPath = (handle: string): string =>
  `/ratings${query('productHandle', handle)}`;

export const emptyCommentsPath = (token: string): string =>
  `/comments${query('authorHandle', token)}`;

export const emptyRatingsPath = (token: string): string =>
  `/ratings${query('raterHandle', token)}`;

export const emptyHelpArticlesPath = (token: string): string =>
  `/help-articles${query('creator', token)}`;

// 本サービスの開始より前の期間のため、どの実行環境でも一致するデータが無い
export const EMPTY_PERIOD_QUERY = 'from=2000-01-01&to=2000-01-02';

export const emptyInquiriesPath = (): string =>
  `/inquiries?${EMPTY_PERIOD_QUERY}`;

export const emptyReportsPath = (): string => `/reports?${EMPTY_PERIOD_QUERY}`;

// 他のテストが作るデータと共有する一覧のため、0件になる条件は固定できない。候補を並べ、実際に0件になった条件を使う
export const QUARANTINED_IMAGE_PATHS: readonly string[] =
  QUARANTINE_REASONS.map(
    (reason) => `/media-moderation${query('reason', reason)}`,
  );

const SPONSORSHIP_STATUSES = [
  'PENDING_PAYMENT',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
  'TERMINATED',
] as const;

const SPONSORSHIP_TIERS = ['LEGEND', 'GOLD', 'SILVER'] as const;

export const SPONSORSHIP_FILTER_PATHS: readonly string[] =
  SPONSORSHIP_STATUSES.flatMap((status) =>
    SPONSORSHIP_TIERS.map(
      (tier) => `/sponsorships?status=${status}&tier=${tier}`,
    ),
  );

export const legalEditorPath = (kind: LegalDocumentKind): string =>
  `/legal-documents/${kind}`;

export const legalRevisionPath = (
  kind: LegalDocumentKind,
  versionNumber: number,
): string => `${legalEditorPath(kind)}/revisions/${String(versionNumber)}`;
