import type { LinkRelToken } from '../markdown/markdown-options.ts';

export type LegalDocumentKind = 'terms' | 'privacy' | 'legal-notice';

export type LegalDocumentPath = '/terms' | '/privacy' | '/legal';

export const LEGAL_DOCUMENT_KINDS: readonly LegalDocumentKind[] = Object.freeze(
  ['terms', 'privacy', 'legal-notice'],
);

export const LEGAL_DOCUMENT_LABELS: Readonly<
  Record<LegalDocumentKind, string>
> = Object.freeze({
  terms: '利用規約',
  privacy: 'プライバシーポリシー',
  'legal-notice': '法的通知',
});

export const LEGAL_DOCUMENT_PATHS: Readonly<
  Record<LegalDocumentKind, LegalDocumentPath>
> = Object.freeze({
  terms: '/terms',
  privacy: '/privacy',
  'legal-notice': '/legal',
});

export const isLegalDocumentKind = (
  value: string,
): value is LegalDocumentKind =>
  (LEGAL_DOCUMENT_KINDS as readonly string[]).includes(value);

export const legalRevisionPath = (
  kind: LegalDocumentKind,
  versionNumber: number,
): string => `${LEGAL_DOCUMENT_PATHS[kind]}/revisions/${String(versionNumber)}`;

// 版番号はGraphQLのInt(32ビットの符号付き整数)で受け渡すため、桁数だけで範囲内と分かる9桁までに限る
const VERSION_NUMBER_PATTERN = /^[1-9][0-9]{0,8}$/;

export const parseVersionNumber = (raw: string): number | undefined =>
  VERSION_NUMBER_PATTERN.test(raw) ? Number.parseInt(raw, 10) : undefined;

export const LEGAL_DOCUMENT_EXTERNAL_LINK_REL: readonly LinkRelToken[] =
  Object.freeze(['noopener']);

export const legalVersionLabel = (versionNumber: number): string =>
  `第${String(versionNumber)}版`;

export const legalVersionTitle = (
  documentLabel: string,
  versionNumber: number,
): string => `${documentLabel}(${legalVersionLabel(versionNumber)})`;
