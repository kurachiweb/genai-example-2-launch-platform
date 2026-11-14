import type { LegalDocumentKind } from '../../../../../common-lib/legal/legal-documents.ts';
import type {
  AdminLegalDocumentView,
  AdminLegalRevisionView,
  AdminLegalVersionView,
} from '../../../../application/legal/legal-document-admin-reader.ts';
import type {
  PublicLegalDocument,
  PublicLegalRevision,
  PublicLegalVersion,
} from '../../../../application/legal/legal-document-reader.ts';
import type { LegalDocumentSummaryRecord } from '../../../../application/legal/ports.ts';

export type LegalDocumentKindValue = 'TERMS' | 'PRIVACY' | 'LEGAL_NOTICE';

export const LEGAL_DOCUMENT_KIND_VALUES: Readonly<
  Record<LegalDocumentKind, LegalDocumentKindValue>
> = Object.freeze({
  terms: 'TERMS',
  privacy: 'PRIVACY',
  'legal-notice': 'LEGAL_NOTICE',
});

const LEGAL_DOCUMENT_KINDS_BY_VALUE: Readonly<
  Record<LegalDocumentKindValue, LegalDocumentKind>
> = Object.freeze({
  TERMS: 'terms',
  PRIVACY: 'privacy',
  LEGAL_NOTICE: 'legal-notice',
});

export const legalDocumentKindOf = (
  value: LegalDocumentKindValue,
): LegalDocumentKind => LEGAL_DOCUMENT_KINDS_BY_VALUE[value];

type WithKindValue<T extends { readonly kind: LegalDocumentKind }> = Omit<
  T,
  'kind'
> & { readonly kind: LegalDocumentKindValue };

export type LegalDocumentVersionModel = WithKindValue<PublicLegalVersion>;

// 生成したリゾルバの型のリストは読み取り専用の配列を受け付けないため、配列は写して渡す
export interface LegalDocumentModel {
  readonly kind: LegalDocumentKindValue;
  readonly latest: LegalDocumentVersionModel | null;
  readonly revisions: PublicLegalRevision[];
}

export type AdminLegalDocumentSummaryModel =
  WithKindValue<LegalDocumentSummaryRecord>;

export interface AdminLegalDocumentModel extends Omit<
  WithKindValue<AdminLegalDocumentView>,
  'revisions'
> {
  readonly revisions: AdminLegalRevisionView[];
}

export type AdminLegalDocumentVersionModel =
  WithKindValue<AdminLegalVersionView>;

function withKindValue<T extends { readonly kind: LegalDocumentKind }>(
  view: T,
): WithKindValue<T> {
  return { ...view, kind: LEGAL_DOCUMENT_KIND_VALUES[view.kind] };
}

export const toLegalDocumentVersion = (
  version: PublicLegalVersion,
): LegalDocumentVersionModel => withKindValue(version);

export const toLegalDocument = (
  document: PublicLegalDocument,
): LegalDocumentModel => ({
  kind: LEGAL_DOCUMENT_KIND_VALUES[document.kind],
  latest:
    document.latest === null ? null : toLegalDocumentVersion(document.latest),
  revisions: [...document.revisions],
});

export const toAdminLegalDocumentSummary = (
  summary: LegalDocumentSummaryRecord,
): AdminLegalDocumentSummaryModel => withKindValue(summary);

export const toAdminLegalDocument = (
  view: AdminLegalDocumentView,
): AdminLegalDocumentModel => ({
  ...withKindValue(view),
  revisions: [...view.revisions],
});

export const toAdminLegalDocumentVersion = (
  view: AdminLegalVersionView,
): AdminLegalDocumentVersionModel => withKindValue(view);
