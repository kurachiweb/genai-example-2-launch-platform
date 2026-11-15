import { inquiryCategoryUnavailableError } from '../../application/inquiry/inquiry-errors.ts';

const FOREIGN_KEY_VIOLATION_PATTERN = /FOREIGN KEY constraint failed/u;

// SQLiteの外部キーの違反は列を示さないため、呼び出し側はカテゴリだけが違反し得る書き込みに使う。一括の書き込みの失敗はD1のエラーがcauseにSQLiteのエラーを持ち、文の組み立ての失敗はDrizzleQueryErrorが包むため、原因をたどって調べる
export function categoryReferenceFailureOf(error: unknown): unknown {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (FOREIGN_KEY_VIOLATION_PATTERN.test(current.message)) {
      return inquiryCategoryUnavailableError();
    }
  }
  return error;
}
