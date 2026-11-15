import { z } from 'zod';

import { countGraphemes } from '../text/graphemes.ts';
import { hasForbiddenCharacters } from '../text/text-safety.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export interface MarkdownTextRule {
  readonly label: string;
  readonly maxGraphemes: number;
  readonly required: boolean;
}

const limitFormat = new Intl.NumberFormat('ja-JP');

const forbiddenCharactersMessage = (label: string): string =>
  `${label}に使用できない文字が含まれています。`;

const requiredMessage = (label: string): string =>
  `${label}を入力してください。`;

const tooLongMessage = (label: string, maxGraphemes: number): string =>
  `${label}は${limitFormat.format(maxGraphemes)}文字以内で入力してください。`;

const isBlank = (text: string): boolean => trimWhiteSpace(text) === '';

const findViolationMessage = (
  { label, maxGraphemes, required }: MarkdownTextRule,
  text: string,
): string | undefined => {
  if (hasForbiddenCharacters(text)) {
    return forbiddenCharactersMessage(label);
  }
  if (required && isBlank(text)) {
    return requiredMessage(label);
  }
  if (countGraphemes(text) > maxGraphemes) {
    return tooLongMessage(label, maxGraphemes);
  }
  return undefined;
};

export const markdownTextSchema = (
  rule: MarkdownTextRule,
): z.ZodType<string> => {
  if (!Number.isInteger(rule.maxGraphemes) || rule.maxGraphemes <= 0) {
    throw new RangeError(
      `maxGraphemesは1以上の整数で指定してください: ${String(rule.maxGraphemes)}`,
    );
  }
  return z.string().superRefine((text, context) => {
    const message = findViolationMessage(rule, text);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });
};
