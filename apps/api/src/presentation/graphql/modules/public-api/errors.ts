import { API_KEY_LIST_MAX_PAGE_SIZE } from '../../../../application/public-api/api-key-management.ts';
import { API_KEY_ERRORS } from '../../../../application/public-api/api-key-errors.ts';

// 名前・権限スコープ・発行の回数・利用者の状態の拒否のコードと文言はユースケースが投げる

// 画面の操作では形式の違うIDを送らないため、存在しないキーと同じ文言を示す
export const API_KEY_ID_INVALID_MESSAGE =
  API_KEY_ERRORS.api_key_not_found.message;

export const API_KEY_PAGE_SIZE_MESSAGE = `表示する件数は1〜${String(API_KEY_LIST_MAX_PAGE_SIZE)}件の整数で指定してください。`;
