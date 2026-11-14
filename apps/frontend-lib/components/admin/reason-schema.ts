import { checkAuditReason } from '../../../common-lib/admin/admin-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import {
  REASON_REQUIRED_MESSAGE,
  REASON_TOO_LONG_MESSAGE,
} from '../../utilities/messages/admin-console-messages.ts';
import { z } from '../../utilities/validation/zod.ts';

export type ReasonSchema = z.ZodType<string | undefined, string>;

const reasonSchemaOf = (required: boolean): ReasonSchema =>
  z
    .string()
    .superRefine((value, context) => {
      if (required && trimWhiteSpace(value) === '') {
        context.addIssue({ code: 'custom', message: REASON_REQUIRED_MESSAGE });
        return;
      }
      if (checkAuditReason(value) !== undefined) {
        context.addIssue({ code: 'custom', message: REASON_TOO_LONG_MESSAGE });
      }
    })
    .transform((value) => {
      const trimmed = trimWhiteSpace(value);
      return trimmed === '' ? undefined : trimmed;
    });

export const REASON_SCHEMAS: Readonly<
  Record<'required' | 'optional', ReasonSchema>
> = Object.freeze({
  required: reasonSchemaOf(true),
  optional: reasonSchemaOf(false),
});
