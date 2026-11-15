import { checkNickname } from '../../../common-lib/identity/account-input-rules.ts';
import {
  checkHandleFormat,
  type HandleFormatCheck,
} from '../../../common-lib/handles/handle-rules.ts';
import {
  BIO_MAX_GRAPHEMES,
  checkHeadline,
  checkWebsiteName,
  type OptionalTextCheck,
  PROFILE_WEBSITES_MAX,
  USER_HANDLE_RULE,
} from '../../../common-lib/profile/profile-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import {
  checkExternalUrl,
  type ExternalUrlCheck,
} from '../../../common-lib/url/external-url.ts';
import { markdownTextSchema } from '../../../common-lib/validation/markdown-text-schema.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { PROFILE_FORM_MESSAGES } from './profile-form-messages.ts';

// 1つの欄には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const NICKNAME_MESSAGES = Object.freeze({
  ok: undefined,
  empty: PROFILE_FORM_MESSAGES.nicknameRequired,
  'too-long': PROFILE_FORM_MESSAGES.nicknameTooLong,
});

const HANDLE_MESSAGES = Object.freeze({
  ok: undefined,
  empty: PROFILE_FORM_MESSAGES.handleRequired,
  'too-long': PROFILE_FORM_MESSAGES.handleTooLong,
  'invalid-characters': PROFILE_FORM_MESSAGES.handleFormat,
} satisfies Record<HandleFormatCheck, string | undefined>);

const HEADLINE_MESSAGES = Object.freeze({
  ok: undefined,
  'forbidden-characters': PROFILE_FORM_MESSAGES.headlineForbiddenCharacters,
  'too-long': PROFILE_FORM_MESSAGES.headlineTooLong,
} satisfies Record<OptionalTextCheck, string | undefined>);

const WEBSITE_NAME_MESSAGES = Object.freeze({
  ok: undefined,
  'forbidden-characters': PROFILE_FORM_MESSAGES.websiteNameForbiddenCharacters,
  'too-long': PROFILE_FORM_MESSAGES.websiteNameTooLong,
} satisfies Record<OptionalTextCheck, string | undefined>);

const WEBSITE_URL_MESSAGES = Object.freeze({
  ok: undefined,
  empty: PROFILE_FORM_MESSAGES.websiteUrlRequired,
  'too-long': PROFILE_FORM_MESSAGES.websiteUrlTooLong,
  'not-absolute': PROFILE_FORM_MESSAGES.websiteUrlFormat,
  'disallowed-scheme': PROFILE_FORM_MESSAGES.websiteUrlFormat,
} satisfies Record<ExternalUrlCheck, string | undefined>);

// 判定と送る値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = ruleOf(
  (value) => NICKNAME_MESSAGES[checkNickname(value)],
).transform(trimWhiteSpace);

// 大文字小文字は保存する表記のまま保ち、空白を含む値は形式の違反にする
const handle = ruleOf(
  (value) => HANDLE_MESSAGES[checkHandleFormat(value, USER_HANDLE_RULE)],
);

// 空の入力は未設定として扱い、送る値はnullにする
const optionalLine = (
  check: (value: string) => OptionalTextCheck,
  messages: Readonly<Record<OptionalTextCheck, string | undefined>>,
) =>
  ruleOf((value) => messages[check(value)]).transform(
    (value): string | null => {
      const trimmed = trimWhiteSpace(value);
      return trimmed === '' ? null : trimmed;
    },
  );

// 空のURLは行を落とさず拒否し、利用者に消す行を選ばせる
const websiteUrl = ruleOf(
  (value) => WEBSITE_URL_MESSAGES[checkExternalUrl(value)],
).transform(trimWhiteSpace);

const BIO_RULE = markdownTextSchema({
  label: '自己紹介',
  maxGraphemes: BIO_MAX_GRAPHEMES,
  required: false,
});

// マークダウンは空白や改行に意味があるため値を変えず、空白だけの入力は未設定として扱う。共用の検証規則は入力の型が未指定のため、文字列の入力として包む
const bio = ruleOf(
  (value) => BIO_RULE.safeParse(value).error?.issues[0]?.message,
).transform((value): string | null =>
  trimWhiteSpace(value) === '' ? null : value,
);

// 読み込んだ時点のハンドル(expectedHandle)は入力欄を描かないため、含めずに送信の時に足す
export const PROFILE_FORM_SCHEMA = z.object({
  nickname,
  handle,
  headline: optionalLine(checkHeadline, HEADLINE_MESSAGES),
  bio,
  avatarFileId: z.string().nullable(),
  websites: z
    .array(
      z.object({
        name: optionalLine(checkWebsiteName, WEBSITE_NAME_MESSAGES),
        url: websiteUrl,
      }),
    )
    .max(PROFILE_WEBSITES_MAX, PROFILE_FORM_MESSAGES.websitesTooMany),
});

export type ProfileFormInput = z.input<typeof PROFILE_FORM_SCHEMA>;

export type ProfileFormValues = z.output<typeof PROFILE_FORM_SCHEMA>;

export const EMPTY_WEBSITE_ROW: ProfileFormInput['websites'][number] =
  Object.freeze({ name: '', url: '' });
