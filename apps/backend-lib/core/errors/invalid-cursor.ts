import { AppError } from './app-error.ts';

// カーソル型のページングで共通にする、ページの位置の指定の誤り
export function invalidCursorError(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'invalid_cursor',
    message: 'ページの位置の指定が正しくありません。',
  });
}
