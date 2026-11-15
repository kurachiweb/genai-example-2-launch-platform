import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import type { LegalDocumentDenial } from '../../domain/legal/legal-document.ts';

interface LegalDocumentErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

export const LEGAL_DOCUMENT_ERRORS = Object.freeze({
  legal_document_conflict: {
    kind: 'conflict',
    message:
      '他の管理者がこの文書を更新しました。最新の内容を読み込んでから、もう一度操作してください。',
  },
  legal_document_draft_missing: {
    kind: 'unprocessable',
    message: '公開する下書きがありません。',
  },
  legal_document_unchanged: {
    kind: 'unprocessable',
    message: '公開中の版から本文が変更されていません。',
  },
} satisfies Readonly<Record<string, LegalDocumentErrorDefinition>>);

export type LegalDocumentErrorCode = keyof typeof LEGAL_DOCUMENT_ERRORS;

const CODE_BY_DENIAL: Readonly<
  Record<LegalDocumentDenial, LegalDocumentErrorCode>
> = Object.freeze({
  stale: 'legal_document_conflict',
  no_draft: 'legal_document_draft_missing',
  unchanged: 'legal_document_unchanged',
});

export const legalDocumentError = (code: LegalDocumentErrorCode): AppError => {
  const { kind, message } = LEGAL_DOCUMENT_ERRORS[code];
  return new AppError({ kind, code, message });
};

export const legalDocumentDenialError = (
  denial: LegalDocumentDenial,
): AppError => legalDocumentError(CODE_BY_DENIAL[denial]);
