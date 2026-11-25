import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';

const UNSAFE_VALUE = 'unknown';

// タグは除去処理の対象外のため、識別子の形の値だけを送る
export function safeTagOf(value: string): string {
  return isUppercaseUlid(value) ? value : UNSAFE_VALUE;
}
