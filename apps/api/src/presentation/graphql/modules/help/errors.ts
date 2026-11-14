import type { HandleFormatCheck } from '../../../../../common-lib/handles/handle-rules.ts';
import {
  HELP_ARTICLE_HANDLE_RULE,
  HELP_SUBTITLE_MAX,
  HELP_TITLE_MAX,
  type HelpTextCheck,
} from '../../../../../common-lib/help/help-input-rules.ts';
import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import {
  HELP_CATEGORY_MISSING_MESSAGE,
  HELP_ERRORS,
} from '../../../../application/help/help-errors.ts';
import { AUDIT_REASON_TOO_LONG_MESSAGE } from '../inquiry/errors.ts';

const textMessagesOf = (
  label: string,
  max: number,
): Readonly<Record<HelpTextCheck, string>> =>
  Object.freeze({
    'forbidden-characters': `${label}に使用できない文字が含まれています。`,
    empty: `${label}を入力してください。`,
    'too-long': `${label}は${String(max)}文字以内で入力してください。`,
  });

// 入力の検証の失敗(validation_error)の欄ごとの文言。カテゴリ名と本文の文言は共用部品の入力規則、ユースケースが投げるエラーの文言はapplication層のhelp-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  categoryNotFound: HELP_ERRORS.help_category_not_found.message,
  // 空・重複・上限超過の並びは画面の操作では起きず、表示中の並びが最新でない時と同じく読み込み直しを促す
  orderInvalid: HELP_ERRORS.help_order_outdated.message,
  articleNotFound: HELP_ERRORS.help_article_not_found.message,
  categoryMissing: HELP_CATEGORY_MISSING_MESSAGE,
  title: textMessagesOf('タイトル', HELP_TITLE_MAX),
  subtitle: textMessagesOf('サブタイトル', HELP_SUBTITLE_MAX),
  handle: Object.freeze({
    ok: undefined,
    empty: 'ハンドルを入力してください。',
    'too-long': `ハンドルは${String(HELP_ARTICLE_HANDLE_RULE.maxLength)}文字以内で入力してください。`,
    'invalid-characters':
      'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  } satisfies Record<HandleFormatCheck, string | undefined>),
  // 理由の違反は監査ログの記録の準備より前に引数の欄で示す
  reasonTooLong: AUDIT_REASON_TOO_LONG_MESSAGE,
});

// GraphQLの引数の名前。検証の詳細の欄と同じく、ユースケースが返す詳細の欄もこの下の経路で示す
export const INPUT_FIELDS_PATH = 'input.fields';

export const callerForbiddenError = (): AppError => authError('forbidden');
