import {
  type HandleFormatCheck,
  type HandleRule,
  IMPERSONATION_RESERVED_HANDLES,
} from '../handles/handle-rules.ts';
import { countGraphemes } from '../text/graphemes.ts';
import { hasForbiddenCharacters } from '../text/text-safety.ts';
import { trimWhiteSpace } from '../text/white-space.ts';
import type { MarkdownTextRule } from '../validation/markdown-text-schema.ts';

export const PRODUCT_NAME_MAX_GRAPHEMES = 50;

export const PRODUCT_TAGLINE_MAX_GRAPHEMES = 100;

export const PRODUCT_DESCRIPTION_MAX_GRAPHEMES = 20_000;

export const PRODUCT_DESCRIPTION_RULE: MarkdownTextRule = Object.freeze({
  label: '説明文',
  maxGraphemes: PRODUCT_DESCRIPTION_MAX_GRAPHEMES,
  required: true,
});

export const PRODUCT_HANDLE_RULE: HandleRule = Object.freeze({
  maxLength: 50,
  reservedWords: IMPERSONATION_RESERVED_HANDLES,
});

export const PRODUCT_CATEGORY_HANDLE_RULE: HandleRule = Object.freeze({
  maxLength: 50,
  reservedWords: Object.freeze([]),
});

const handleMessagesOf = (
  rule: HandleRule,
): Readonly<Record<HandleFormatCheck, string | undefined>> =>
  Object.freeze({
    ok: undefined,
    empty: 'ハンドルを入力してください。',
    'too-long': `ハンドルは${String(rule.maxLength)}文字以内で入力してください。`,
    'invalid-characters':
      'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  });

export const PRODUCT_HANDLE_MESSAGES = handleMessagesOf(PRODUCT_HANDLE_RULE);

export const PRODUCT_CATEGORY_HANDLE_MESSAGES = handleMessagesOf(
  PRODUCT_CATEGORY_HANDLE_RULE,
);

export const PRODUCT_LOGO_PURPOSE = 'product-logo';

export const PRODUCT_LOGO_MAX_BYTES = 512_000;

export const PRODUCT_SCREENSHOT_PURPOSE = 'product-screenshot';

export const PRODUCT_SCREENSHOT_MAX_BYTES = 5_242_880;

export const PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES = 10_485_760;

export const PRODUCT_SCREENSHOTS_MAX = 20;

export const LAUNCH_DATE_HORIZON_DAYS = 90;

export type RequiredTextCheck =
  'ok' | 'empty' | 'too-long' | 'forbidden-characters';

const checkRequiredText = (value: string, max: number): RequiredTextCheck => {
  // VT・FF・NELは空白でもあるため、前後の空白を除く前に調べて、端にあっても黙って除かずに拒む
  if (hasForbiddenCharacters(value)) {
    return 'forbidden-characters';
  }
  const graphemes = countGraphemes(trimWhiteSpace(value));
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > max ? 'too-long' : 'ok';
};

export const checkProductName = (value: string): RequiredTextCheck =>
  checkRequiredText(value, PRODUCT_NAME_MAX_GRAPHEMES);

export const checkTagline = (value: string): RequiredTextCheck =>
  checkRequiredText(value, PRODUCT_TAGLINE_MAX_GRAPHEMES);

const limitFormat = new Intl.NumberFormat('ja-JP');

const messagesOf = (
  subject: string,
  max: number,
): Readonly<Record<RequiredTextCheck, string | undefined>> =>
  Object.freeze({
    ok: undefined,
    empty: `${subject}を入力してください。`,
    'too-long': `${subject}は${limitFormat.format(max)}文字以内で入力してください。`,
    'forbidden-characters': `${subject}に使用できない文字が含まれています。`,
  });

export const PRODUCT_NAME_MESSAGES = messagesOf(
  '名称',
  PRODUCT_NAME_MAX_GRAPHEMES,
);

export const PRODUCT_TAGLINE_MESSAGES = messagesOf(
  'タグライン',
  PRODUCT_TAGLINE_MAX_GRAPHEMES,
);

export type ScreenshotTotalsCheck = 'ok' | 'too-many' | 'too-large';

export const checkScreenshotTotals = (
  sizes: readonly number[],
): ScreenshotTotalsCheck => {
  if (sizes.length > PRODUCT_SCREENSHOTS_MAX) {
    return 'too-many';
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES ? 'too-large' : 'ok';
};
