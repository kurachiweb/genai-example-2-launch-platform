import { EMAIL_MAX_LENGTH } from '../../../common-lib/identity/account-input-rules.ts';
import {
  checkSenderInfoLengths,
  type SenderInfoField,
  type SenderInfoInput,
} from '../../../common-lib/notifications/sender-info-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import {
  SENDER_INFO_EMAIL_FORMAT_MESSAGE,
  senderInfoRequiredMessageOf,
  senderInfoTooLongMessageOf,
} from './sender-info-messages.ts';

// APIサーバーのisValidEmailAddressと同じく、WHATWGの形式と254文字以内で判定する
const isValidContactEmail = (value: string): boolean => {
  const trimmed = trimWhiteSpace(value);
  return (
    trimmed.length <= EMAIL_MAX_LENGTH && z.regexes.html5Email.test(trimmed)
  );
};

const issueOf = (
  field: SenderInfoField,
  reason: 'empty' | 'too-long',
): string =>
  reason === 'empty'
    ? senderInfoRequiredMessageOf(field)
    : senderInfoTooLongMessageOf(field);

const trimmedInputOf = (input: SenderInfoInput): SenderInfoInput => ({
  businessName: trimWhiteSpace(input.businessName),
  contactEmail: trimWhiteSpace(input.contactEmail),
  postalAddress: trimWhiteSpace(input.postalAddress),
});

// 欄の値は描く3項目だけにし、読み込んだ版と確認のダイアログの理由は送る時に足す。1つの欄には、未入力・文字数超過・形式違反の順で最初の1つだけを示す
export const SENDER_INFO_FORM_SCHEMA = z
  .object({
    businessName: z.string(),
    contactEmail: z.string(),
    postalAddress: z.string(),
  })
  .superRefine((input, context) => {
    const violations = checkSenderInfoLengths(input);
    for (const { field, reason } of violations) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: issueOf(field, reason),
      });
    }
    const emailChecked = violations.every(
      ({ field }) => field !== 'contactEmail',
    );
    if (emailChecked && !isValidContactEmail(input.contactEmail)) {
      context.addIssue({
        code: 'custom',
        path: ['contactEmail'],
        message: SENDER_INFO_EMAIL_FORMAT_MESSAGE,
      });
    }
  })
  .transform(trimmedInputOf);

export type SenderInfoFormInput = z.input<typeof SENDER_INFO_FORM_SCHEMA>;

export type SenderInfoFormOutput = z.output<typeof SENDER_INFO_FORM_SCHEMA>;
