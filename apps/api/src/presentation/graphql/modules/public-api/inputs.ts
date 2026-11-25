import { z } from 'zod';

import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import { API_KEY_LIST_MAX_PAGE_SIZE } from '../../../../application/public-api/api-key-management.ts';
import { READ_LEVEL_RECORDS, WRITE_LEVEL_RECORDS } from './api-key-views.ts';
import {
  API_KEY_ID_INVALID_MESSAGE,
  API_KEY_PAGE_SIZE_MESSAGE,
} from './errors.ts';

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
const apiKeyId = z
  .ulid({ error: API_KEY_ID_INVALID_MESSAGE, abort: true })
  .regex(UPPERCASE_ULID_PATTERN, API_KEY_ID_INVALID_MESSAGE);

// 値の範囲はGraphQLの列挙型が確かめる
const readLevel = z
  .enum(['NONE', 'READ'])
  .transform((value) => READ_LEVEL_RECORDS[value]);

const writeLevel = z
  .enum(['NONE', 'READ', 'READ_WRITE'])
  .transform((value) => WRITE_LEVEL_RECORDS[value]);

// 名前の空・文字数の上限と権限スコープの規則はユースケースが確かめ、欄ごとの理由のコードを返す
const apiKeyInput = z.object({
  name: z.string(),
  scopes: z.object({
    products: readLevel,
    launches: readLevel,
    upvotes: readLevel,
    comments: readLevel,
    ratings: readLevel,
    profile: writeLevel,
    productDescriptions: writeLevel,
  }),
});

// 件数は既定値があり、明示したnullだけが届き得る。不正な位置はユースケースがinvalid_cursorにする
export const MY_API_KEYS_ARGS = z.object({
  first: z
    .int(API_KEY_PAGE_SIZE_MESSAGE)
    .min(1, API_KEY_PAGE_SIZE_MESSAGE)
    .max(API_KEY_LIST_MAX_PAGE_SIZE, API_KEY_PAGE_SIZE_MESSAGE)
    .nullish()
    .transform((value) => value ?? API_KEY_LIST_MAX_PAGE_SIZE),
  after: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
});

export const ISSUE_API_KEY_ARGS = z.object({ input: apiKeyInput });

export const UPDATE_API_KEY_ARGS = z.object({
  id: apiKeyId,
  input: apiKeyInput,
});

export const API_KEY_ID_ARGS = z.object({ id: apiKeyId });
