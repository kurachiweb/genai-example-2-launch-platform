import { AUDIT_REASON_MAX } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';

// ニックネーム・本文・チャットのメッセージの違反の文言は画面と共有するcommon-libのinquiry-input-rules.tsに、カテゴリの不在・添付の文言とユースケースが投げるエラーの文言はapplication層のinquiry-errors.tsにある

// 問い合わせのモジュールは管理者のモジュールを読み込めないため、監査ログの記録の準備と同じ文言をここでも組み立てる
export const AUDIT_REASON_TOO_LONG_MESSAGE = `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`;

// GraphQLの引数の名前。検証の詳細の欄と同じく、ユースケースが返す詳細の欄もこの下の経路で示す
export const INPUT_ARGUMENT = 'input';

export const callerForbiddenError = (): AppError => authError('forbidden');
