import { z } from '@hono/zod-openapi';

import {
  checkHandleFormat,
  type HandleFormatCheck,
} from '../../../../../common-lib/handles/handle-rules.ts';
import {
  checkNickname,
  NICKNAME_MAX_GRAPHEMES,
  type NicknameCheck,
} from '../../../../../common-lib/identity/account-input-rules.ts';
import {
  BIO_MAX_GRAPHEMES,
  checkHeadline,
  checkWebsiteName,
  HEADLINE_MAX_GRAPHEMES,
  type OptionalTextCheck,
  PROFILE_WEBSITES_MAX,
  USER_HANDLE_RULE,
  WEBSITE_NAME_MAX_GRAPHEMES,
} from '../../../../../common-lib/profile/profile-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import {
  checkExternalUrl,
  EXTERNAL_URL_MAX_LENGTH,
  type ExternalUrlCheck,
} from '../../../../../common-lib/url/external-url.ts';
import { markdownTextSchema } from '../../../../../common-lib/validation/markdown-text-schema.ts';
import { ApiImageSchema, PUBLIC_API_INVALID_TYPE_MESSAGE } from './common.ts';

const countFormat = new Intl.NumberFormat('ja-JP');

// GraphQLの表現層の文言は読み込めないため、プロフィールの設定画面とGraphQLの保存と同じ文言をここにも持つ(単体テストで一致を確かめる)
export const PROFILE_FIELD_MESSAGES = Object.freeze({
  nicknameRequired: 'ニックネームを入力してください。',
  nicknameTooLong: `ニックネームは${String(NICKNAME_MAX_GRAPHEMES)}文字以内で入力してください。`,
  handleRequired: 'ハンドルを入力してください。',
  handleTooLong: `ハンドルは${String(USER_HANDLE_RULE.maxLength)}文字以内で入力してください。`,
  handleFormat:
    'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
  headlineForbiddenCharacters:
    'ヘッドラインに使用できない文字が含まれています。',
  headlineTooLong: `ヘッドラインは${String(HEADLINE_MAX_GRAPHEMES)}文字以内で入力してください。`,
  websitesTooMany: `外部Webサイトは${String(PROFILE_WEBSITES_MAX)}件以内で入力してください。`,
  websiteNameForbiddenCharacters:
    '外部Webサイトの名前に使用できない文字が含まれています。',
  websiteNameTooLong: `外部Webサイトの名前は${String(WEBSITE_NAME_MAX_GRAPHEMES)}文字以内で入力してください。`,
  websiteUrlRequired: '外部WebサイトのURLを入力してください。',
  websiteUrlTooLong: `外部WebサイトURLは${countFormat.format(EXTERNAL_URL_MAX_LENGTH)}文字以内で入力してください。`,
  websiteUrlFormat:
    '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。',
});

// 公開APIの本文だけで起きる誤り。画面は型と項目をフォームが決めるため起きない
export const MY_PROFILE_PATCH_MESSAGES = Object.freeze({
  noFields: '更新する項目を1つ以上指定してください。',
  unknownFields: '更新できない項目が含まれています。',
  invalidType: PUBLIC_API_INVALID_TYPE_MESSAGE,
});

const NICKNAME_MESSAGES = Object.freeze({
  ok: undefined,
  empty: PROFILE_FIELD_MESSAGES.nicknameRequired,
  'too-long': PROFILE_FIELD_MESSAGES.nicknameTooLong,
} satisfies Record<NicknameCheck, string | undefined>);

const HANDLE_MESSAGES = Object.freeze({
  ok: undefined,
  empty: PROFILE_FIELD_MESSAGES.handleRequired,
  'too-long': PROFILE_FIELD_MESSAGES.handleTooLong,
  'invalid-characters': PROFILE_FIELD_MESSAGES.handleFormat,
} satisfies Record<HandleFormatCheck, string | undefined>);

const HEADLINE_MESSAGES = Object.freeze({
  ok: undefined,
  'forbidden-characters': PROFILE_FIELD_MESSAGES.headlineForbiddenCharacters,
  'too-long': PROFILE_FIELD_MESSAGES.headlineTooLong,
} satisfies Record<OptionalTextCheck, string | undefined>);

const WEBSITE_NAME_MESSAGES = Object.freeze({
  ok: undefined,
  'forbidden-characters': PROFILE_FIELD_MESSAGES.websiteNameForbiddenCharacters,
  'too-long': PROFILE_FIELD_MESSAGES.websiteNameTooLong,
} satisfies Record<OptionalTextCheck, string | undefined>);

const WEBSITE_URL_MESSAGES = Object.freeze({
  ok: undefined,
  empty: PROFILE_FIELD_MESSAGES.websiteUrlRequired,
  'too-long': PROFILE_FIELD_MESSAGES.websiteUrlTooLong,
  'not-absolute': PROFILE_FIELD_MESSAGES.websiteUrlFormat,
  'disallowed-scheme': PROFILE_FIELD_MESSAGES.websiteUrlFormat,
} satisfies Record<ExternalUrlCheck, string | undefined>);

const typedString = () =>
  z.string({ error: MY_PROFILE_PATCH_MESSAGES.invalidType });

// 1つの項目には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  typedString().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = trimWhiteSpace(value ?? '');
  return trimmed === '' ? null : trimmed;
};

const strictObject = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? MY_PROFILE_PATCH_MESSAGES.unknownFields
        : MY_PROFILE_PATCH_MESSAGES.invalidType,
  });

// 以下の正規化はGraphQLのプロフィールの保存(UPDATE_MY_PROFILE_ARGS)と同じ規則で、同じ入力が同じ値で保存される
const nickname = ruleOf(
  (value) => NICKNAME_MESSAGES[checkNickname(value)],
).transform(trimWhiteSpace);

// 大文字小文字は保存する表記のまま保ち、空白を含む値は形式の違反にする
const handle = ruleOf(
  (value) => HANDLE_MESSAGES[checkHandleFormat(value, USER_HANDLE_RULE)],
);

const headline = ruleOf((value) => HEADLINE_MESSAGES[checkHeadline(value)])
  .nullable()
  .transform(blankToNull);

const BIO_RULE = markdownTextSchema({
  label: '自己紹介',
  maxGraphemes: BIO_MAX_GRAPHEMES,
  required: false,
});

// 型の誤りを他の項目と同じ文言にするため、文字列であることを先に確かめてからマークダウンの入力欄の規則を当てる。マークダウンは空白や改行に意味があるため値を変えず、空白だけの入力は未設定として扱う
const bioMarkdown = ruleOf(
  (value) => BIO_RULE.safeParse(value).error?.issues[0]?.message,
)
  .nullable()
  .transform((value): string | null =>
    value === null || trimWhiteSpace(value) === '' ? null : value,
  );

const websiteName = ruleOf(
  (value) => WEBSITE_NAME_MESSAGES[checkWebsiteName(value)],
)
  .nullish()
  .transform(blankToNull);

// 空のURLは行を落とさず拒否し、利用者に消す行を選ばせる
const websiteUrl = ruleOf(
  (value) => WEBSITE_URL_MESSAGES[checkExternalUrl(value)],
).transform(trimWhiteSpace);

const websites = z
  .array(
    strictObject({
      name: websiteName.openapi({
        description: `表示名(前後の空白を除いて${String(WEBSITE_NAME_MAX_GRAPHEMES)}文字以内)。省略・null・空白だけはnull。`,
      }),
      url: websiteUrl.openapi({
        description: `http://またはhttps://から始まるURL(${countFormat.format(EXTERNAL_URL_MAX_LENGTH)}文字以内)。前後の空白を除く。`,
      }),
    }),
    { error: MY_PROFILE_PATCH_MESSAGES.invalidType },
  )
  .max(PROFILE_WEBSITES_MAX, PROFILE_FIELD_MESSAGES.websitesTooMany);

export const MyProfilePatchSchema = strictObject({
  nickname: nickname.optional().openapi({
    description: `ニックネーム(前後の空白を除いて1〜${String(NICKNAME_MAX_GRAPHEMES)}文字)。前後の空白を除いて保存する。`,
  }),
  handle: handle.optional().openapi({
    description: `ハンドル(英数字で始まる英数字・ハイフン・アンダースコアの${String(USER_HANDLE_RULE.maxLength)}文字以内)。予約語と他の利用者が使用中のハンドルは409(handle_unavailable)になる。変更前のハンドルは旧ハンドルとして保持される。`,
  }),
  headline: headline.optional().openapi({
    description: `ヘッドライン(前後の空白を除いて${String(HEADLINE_MAX_GRAPHEMES)}文字以内)。null・空白だけは未設定にする。`,
  }),
  bio_markdown: bioMarkdown.optional().openapi({
    description: `自己紹介のマークダウン(${countFormat.format(BIO_MAX_GRAPHEMES)}文字以内)。値はそのまま保存し、null・空白だけは未設定にする。`,
  }),
  websites: websites.optional().openapi({
    description: `外部Webサイトの一覧(${String(PROFILE_WEBSITES_MAX)}件以内)。指定した一覧で全体を置き換える。`,
  }),
})
  .refine((patch) => Object.keys(patch).length > 0, {
    error: MY_PROFILE_PATCH_MESSAGES.noFields,
    // 未知の項目だけの本文は、項目の不足ではなく未知の項目の誤りだけを示す
    when: (payload) => payload.issues.length === 0,
  })
  .openapi('MyProfilePatch', {
    description:
      '更新する項目だけを1つ以上指定する。指定しない項目は現在の値を保つ。プロフィール画像は変更できず、画像を含めてこの5項目の他の項目を含めると400(validation_error)になる。',
  });

const ProfileWebsiteSchema = z
  .object({
    name: z.string().nullable(),
    url: z.string(),
  })
  .openapi('ProfileWebsite');

const profileFields = {
  handle: z.string(),
  nickname: z.string(),
  headline: z.string().nullable(),
  bio_markdown: z.string().nullable(),
  avatar: ApiImageSchema.nullable(),
  websites: z.array(ProfileWebsiteSchema),
  profile_url: z
    .url()
    .openapi({ description: '公開プロフィールのページのURL' }),
};

export const PublicProfileSchema = z
  .object({
    ...profileFields,
    follower_count: z.int().min(0).openapi({
      description: '停止中の利用者を除いたフォロワーの数',
    }),
    ultras: z.boolean().openapi({ description: 'Ultrasに加入中かどうか' }),
  })
  .openapi('PublicProfile');

export const MyProfileSchema = z
  .object({
    ...profileFields,
    previous_handle: z.string().nullable().openapi({
      description:
        '保持中の旧ハンドル。旧ハンドルの公開プロフィールの要求は現在のハンドルへ転送される。',
    }),
  })
  .openapi('MyProfile');

export type MyProfilePatchBody = z.infer<typeof MyProfilePatchSchema>;

export type PublicProfile = z.infer<typeof PublicProfileSchema>;

export type MyProfile = z.infer<typeof MyProfileSchema>;
