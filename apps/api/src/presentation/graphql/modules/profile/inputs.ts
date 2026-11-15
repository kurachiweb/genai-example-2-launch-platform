import { z } from 'zod';

import { checkNickname } from '../../../../../common-lib/identity/account-input-rules.ts';
import {
  checkHandleFormat,
  type HandleFormatCheck,
} from '../../../../../common-lib/handles/handle-rules.ts';
import {
  BIO_MAX_GRAPHEMES,
  checkHeadline,
  checkWebsiteName,
  type OptionalTextCheck,
  PROFILE_WEBSITES_MAX,
  USER_HANDLE_RULE,
} from '../../../../../common-lib/profile/profile-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import {
  checkExternalUrl,
  type ExternalUrlCheck,
} from '../../../../../common-lib/url/external-url.ts';
import { markdownTextSchema } from '../../../../../common-lib/validation/markdown-text-schema.ts';
import type { ProfileUpdateInput } from '../../../../application/profile/profile-editor.ts';
import { inputRuleOf } from '../../auth-inputs.ts';
import { INPUT_MESSAGES } from './errors.ts';

// ULIDは26文字で、一致しない値はユースケースが本人の画像でないものとして扱う。ここでは処理量だけを抑える
const FILE_ID_INPUT_MAX_LENGTH = 64;

const NICKNAME_MESSAGES = Object.freeze({
  ok: undefined,
  empty: INPUT_MESSAGES.nicknameRequired,
  'too-long': INPUT_MESSAGES.nicknameTooLong,
});

const HANDLE_MESSAGES = Object.freeze({
  ok: undefined,
  empty: INPUT_MESSAGES.handleRequired,
  'too-long': INPUT_MESSAGES.handleTooLong,
  'invalid-characters': INPUT_MESSAGES.handleFormat,
} satisfies Record<HandleFormatCheck, string | undefined>);

const HEADLINE_MESSAGES = Object.freeze({
  ok: undefined,
  'forbidden-characters': INPUT_MESSAGES.headlineForbiddenCharacters,
  'too-long': INPUT_MESSAGES.headlineTooLong,
} satisfies Record<OptionalTextCheck, string | undefined>);

const WEBSITE_NAME_MESSAGES = Object.freeze({
  ok: undefined,
  'forbidden-characters': INPUT_MESSAGES.websiteNameForbiddenCharacters,
  'too-long': INPUT_MESSAGES.websiteNameTooLong,
} satisfies Record<OptionalTextCheck, string | undefined>);

const WEBSITE_URL_MESSAGES = Object.freeze({
  ok: undefined,
  empty: INPUT_MESSAGES.websiteUrlRequired,
  'too-long': INPUT_MESSAGES.websiteUrlTooLong,
  'not-absolute': INPUT_MESSAGES.websiteUrlFormat,
  'disallowed-scheme': INPUT_MESSAGES.websiteUrlFormat,
} satisfies Record<ExternalUrlCheck, string | undefined>);

// 判定と保存値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = inputRuleOf(
  (value) => NICKNAME_MESSAGES[checkNickname(value)],
).transform(trimWhiteSpace);

// 大文字小文字は保存する表記のまま保ち、空白を含む値は形式の違反にする
const handle = inputRuleOf(
  (value) => HANDLE_MESSAGES[checkHandleFormat(value, USER_HANDLE_RULE)],
);

// 空の入力は未設定として扱い、保存する値はnullにする
const optionalLine = (
  check: (value: string) => OptionalTextCheck,
  messages: Readonly<Record<OptionalTextCheck, string | undefined>>,
) =>
  inputRuleOf((value) => messages[check(value)])
    .nullish()
    .transform((value): string | null => {
      const trimmed = trimWhiteSpace(value ?? '');
      return trimmed === '' ? null : trimmed;
    });

// 空のURLは行を落とさず拒否し、利用者に消す行を選ばせる
const websiteUrl = inputRuleOf(
  (value) => WEBSITE_URL_MESSAGES[checkExternalUrl(value)],
).transform(trimWhiteSpace);

// マークダウンは空白や改行に意味があるため値を変えず、空白だけの入力は未設定として扱う
const bio = markdownTextSchema({
  label: '自己紹介',
  maxGraphemes: BIO_MAX_GRAPHEMES,
  required: false,
})
  .nullish()
  .transform((value): string | null =>
    value == null || trimWhiteSpace(value) === '' ? null : value,
  );

const avatarFileId = z
  .string()
  .max(FILE_ID_INPUT_MAX_LENGTH, INPUT_MESSAGES.avatarInvalid)
  .nullish()
  .transform((value) => value ?? null);

export const UPDATE_MY_PROFILE_ARGS = z.object({
  input: z
    .object({
      nickname,
      handle,
      expectedHandle: z.string(),
      headline: optionalLine(checkHeadline, HEADLINE_MESSAGES),
      bio,
      avatarFileId,
      websites: z
        .array(
          z.object({
            name: optionalLine(checkWebsiteName, WEBSITE_NAME_MESSAGES),
            url: websiteUrl,
          }),
        )
        .max(PROFILE_WEBSITES_MAX, INPUT_MESSAGES.websitesTooMany),
    })
    .transform(({ bio: bioMarkdown, ...rest }): ProfileUpdateInput => ({
      ...rest,
      bioMarkdown,
    })),
});

// 26文字以上は形式の確認に値しないため、検証の失敗として拒否する。空や文字種の違反は判定の結果INVALIDで返す
export const HANDLE_AVAILABILITY_ARGS = z.object({
  handle: z
    .string()
    .max(USER_HANDLE_RULE.maxLength, INPUT_MESSAGES.handleTooLong),
});
