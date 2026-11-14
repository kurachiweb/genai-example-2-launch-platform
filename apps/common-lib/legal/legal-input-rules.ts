import { z } from 'zod';

import { countGraphemes } from '../text/graphemes.ts';
import { hasForbiddenCharacters } from '../text/text-safety.ts';
import { trimWhiteSpace } from '../text/white-space.ts';
import {
  type MarkdownTextRule,
  markdownTextSchema,
} from '../validation/markdown-text-schema.ts';

export const LEGAL_BODY_MAX = 100_000;

export const CHANGE_SUMMARY_MAX = 200;

export const LEGAL_BODY_RULE: MarkdownTextRule = Object.freeze({
  label: '本文',
  maxGraphemes: LEGAL_BODY_MAX,
  required: true,
});

export type ChangeSummaryIssue =
  'empty' | 'too-long' | 'line-break' | 'forbidden-character';

const LINE_BREAK_PATTERN = /[\n\r]/;

export const checkChangeSummary = (
  value: string,
): ChangeSummaryIssue | undefined => {
  // VT・FF・NELは空白でもあるため、前後の空白を除く前に調べて、端にあっても黙って除かずに拒む
  if (hasForbiddenCharacters(value)) {
    return 'forbidden-character';
  }
  const trimmed = trimWhiteSpace(value);
  if (LINE_BREAK_PATTERN.test(trimmed)) {
    return 'line-break';
  }
  if (trimmed === '') {
    return 'empty';
  }
  return countGraphemes(trimmed) > CHANGE_SUMMARY_MAX ? 'too-long' : undefined;
};

export const CHANGE_SUMMARY_MESSAGES: Readonly<
  Record<ChangeSummaryIssue, string>
> = Object.freeze({
  'forbidden-character': '変更概要に使用できない文字が含まれています。',
  'line-break': '変更概要に改行は使用できません。',
  empty: '変更概要を入力してください。',
  'too-long': `変更概要は${String(CHANGE_SUMMARY_MAX)}文字以内で入力してください。`,
});

export const changeSummarySchema = (): z.ZodType<string> =>
  z
    .string()
    .superRefine((value, context) => {
      const issue = checkChangeSummary(value);
      if (issue !== undefined) {
        context.addIssue({
          code: 'custom',
          message: CHANGE_SUMMARY_MESSAGES[issue],
        });
      }
    })
    .transform(trimWhiteSpace);

export const legalBodySchema = (): z.ZodType<string> =>
  markdownTextSchema(LEGAL_BODY_RULE);
