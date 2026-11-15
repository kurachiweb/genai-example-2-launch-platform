import { countGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const SENDER_INFO_MAX_GRAPHEMES = 200;

export type SenderInfoField = 'businessName' | 'contactEmail' | 'postalAddress';

export interface SenderInfoViolation {
  readonly field: SenderInfoField;
  readonly reason: 'empty' | 'too-long';
}

export type SenderInfoInput = Readonly<Record<SenderInfoField, string>>;

const SENDER_INFO_FIELDS: readonly SenderInfoField[] = Object.freeze([
  'businessName',
  'contactEmail',
  'postalAddress',
]);

const lengthViolationOf = (
  value: string,
): SenderInfoViolation['reason'] | undefined => {
  const graphemes = countGraphemes(trimWhiteSpace(value));
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > SENDER_INFO_MAX_GRAPHEMES ? 'too-long' : undefined;
};

export const checkSenderInfoLengths = (
  input: SenderInfoInput,
): readonly SenderInfoViolation[] =>
  SENDER_INFO_FIELDS.flatMap((field) => {
    const reason = lengthViolationOf(input[field]);
    return reason === undefined ? [] : [{ field, reason }];
  });
