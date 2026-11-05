import { AUDIT_REASON_MAX } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import {
  GUEST_NICKNAME_MAX,
  INQUIRY_BODY_MAX,
  type InquiryTextIssue,
} from '../../../../../common-lib/inquiry/inquiry-input-rules.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';

const limitFormat = new Intl.NumberFormat('ja-JP');

// 入力の検証の失敗(validation_error)の欄ごとの文言。チャットのメッセージ・カテゴリの不在・添付の文言と、ユースケースが投げるエラーの文言はapplication層のinquiry-errors.tsにある
export const GUEST_NICKNAME_MESSAGES: Readonly<
  Record<InquiryTextIssue, string>
> = Object.freeze({
  'forbidden-character': 'ニックネームに使用できない文字が含まれています。',
  empty: 'ニックネームを入力してください。',
  'too-long': `ニックネームは${limitFormat.format(GUEST_NICKNAME_MAX)}文字以内で入力してください。`,
});

export const INQUIRY_BODY_MESSAGES: Readonly<Record<InquiryTextIssue, string>> =
  Object.freeze({
    'forbidden-character': 'メッセージに使用できない文字が含まれています。',
    empty: 'メッセージを入力してください。',
    'too-long': `メッセージは${limitFormat.format(INQUIRY_BODY_MAX)}文字以内で入力してください。`,
  });

// 問い合わせのモジュールは管理者のモジュールを読み込めないため、監査ログの記録の準備と同じ文言をここでも組み立てる
export const AUDIT_REASON_TOO_LONG_MESSAGE = `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`;

// GraphQLの引数の名前。検証の詳細の欄と同じく、ユースケースが返す詳細の欄もこの下の経路で示す
export const INPUT_ARGUMENT = 'input';

export const callerForbiddenError = (): AppError => authError('forbidden');
