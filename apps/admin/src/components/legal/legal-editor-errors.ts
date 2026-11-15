import type { SubmitErrorContext } from '../../../lib/components/form/app-form.tsx';
import {
  errorMessageOf,
  type FieldErrorDetail,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  LEGAL_BODY_TOO_LARGE_MESSAGE,
  LEGAL_CONFLICT_MESSAGE,
  LEGAL_DRAFT_MISSING_MESSAGE,
  LEGAL_UNCHANGED_MESSAGE,
} from './legal-editor-messages.ts';

export type LegalEditorErrorState =
  | { readonly kind: 'conflict' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'no-draft' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'field'; readonly details: readonly FieldErrorDetail[] }
  | { readonly kind: 'unexpected'; readonly message: string };

type CodedErrorKind = Exclude<
  LegalEditorErrorState['kind'],
  'field' | 'unexpected'
>;

const KIND_BY_CODE: Readonly<Record<string, CodedErrorKind>> = Object.freeze({
  legal_document_conflict: 'conflict',
  legal_document_unchanged: 'unchanged',
  legal_document_draft_missing: 'no-draft',
  payload_too_large: 'too-large',
});

const VALIDATION_ERROR_CODE = 'validation_error';

const unexpectedOf = (error: unknown): LegalEditorErrorState => ({
  kind: 'unexpected',
  message: errorMessageOf(error, ADMIN_PROFILE.contactAvailable),
});

// AppFormのonSubmitErrorから受けた時は、欄に示せなかった詳細だけを残す
export function toLegalEditorErrorState(
  error: unknown,
  context?: SubmitErrorContext,
): LegalEditorErrorState {
  if (!(error instanceof GraphQLClientError)) {
    return unexpectedOf(error);
  }
  const kind = Object.hasOwn(KIND_BY_CODE, error.code)
    ? KIND_BY_CODE[error.code]
    : undefined;
  if (kind !== undefined) {
    return { kind };
  }
  if (error.code === VALIDATION_ERROR_CODE) {
    const details = context?.unmatched ?? error.details ?? [];
    if (details.length > 0) {
      return { kind: 'field', details };
    }
  }
  return unexpectedOf(error);
}

const MESSAGE_BY_KIND: Readonly<Record<CodedErrorKind, string>> = Object.freeze(
  {
    conflict: LEGAL_CONFLICT_MESSAGE,
    unchanged: LEGAL_UNCHANGED_MESSAGE,
    'no-draft': LEGAL_DRAFT_MISSING_MESSAGE,
    'too-large': LEGAL_BODY_TOO_LARGE_MESSAGE,
  },
);

export function legalEditorErrorMessageOf(
  state: LegalEditorErrorState,
): string {
  switch (state.kind) {
    case 'field':
      return [...new Set(state.details.map(({ message }) => message))].join('');
    case 'unexpected':
      return state.message;
    default:
      return MESSAGE_BY_KIND[state.kind];
  }
}
