import {
  changeSummarySchema,
  legalBodySchema,
} from '../../../common-lib/legal/legal-input-rules.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

// 共用部品の規則は文字列でない値も受けて拒むため入力の型を持たない。フォームの欄の値は常に文字列のため、入力の型を文字列に絞る
const textRuleOf = (rule: z.ZodType<string>): z.ZodType<string, string> =>
  rule as z.ZodType<string, string>;

// 文書の種類と読み込んだ状態の版は入力欄を描かないため含めず、送信の時に足す
export const legalDraftFormSchema = z.object({
  body: textRuleOf(legalBodySchema()),
});

export type LegalDraftFormInput = z.input<typeof legalDraftFormSchema>;

export const publishFormSchema = z.object({
  changeSummary: textRuleOf(changeSummarySchema()),
});

export type PublishFormInput = z.input<typeof publishFormSchema>;
