import {
  type ApiKeyFeature,
  type ApiKeyNameCheck,
  type ApiKeyReadLevel,
  type ApiKeyScopes,
  type ApiKeyWriteLevel,
  checkApiKeyName,
  DEFAULT_ISSUE_SCOPES,
  isAllowedScopeLevel,
} from '../../../common-lib/public-api/api-key-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import { API_KEY_FORM_MESSAGES } from './api-key-form-messages.ts';

// フォームの値はGraphQLのApiKeyInputと同じ形にし、サーバーの詳細(input.name・input.scopes.<機能>)をそのまま欄に付ける
export interface ApiKeyFormValues {
  readonly name: string;
  readonly scopes: ApiKeyScopes;
}

type NameIssue = Extract<ApiKeyNameCheck, { readonly ok: false }>['reason'];

const NAME_MESSAGES: Readonly<Record<NameIssue, string>> = Object.freeze({
  required: API_KEY_FORM_MESSAGES.nameRequired,
  too_long: API_KEY_FORM_MESSAGES.nameTooLong,
});

// 判定と送る値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const name = z
  .string()
  .superRefine((value, context) => {
    const check = checkApiKeyName(value);
    if (!check.ok) {
      context.addIssue({
        code: 'custom',
        message: NAME_MESSAGES[check.reason],
      });
    }
  })
  .transform(trimWhiteSpace);

const levelOf = <TLevel extends ApiKeyWriteLevel>(feature: ApiKeyFeature) =>
  z.custom<TLevel>(
    (value) => typeof value === 'string' && isAllowedScopeLevel(feature, value),
    { error: API_KEY_FORM_MESSAGES.scopeNotAllowed },
  );

export const apiKeyFormSchema: z.ZodType<ApiKeyFormValues, ApiKeyFormValues> =
  z.object({
    name,
    scopes: z.object({
      products: levelOf<ApiKeyReadLevel>('products'),
      launches: levelOf<ApiKeyReadLevel>('launches'),
      upvotes: levelOf<ApiKeyReadLevel>('upvotes'),
      comments: levelOf<ApiKeyReadLevel>('comments'),
      ratings: levelOf<ApiKeyReadLevel>('ratings'),
      profile: levelOf<ApiKeyWriteLevel>('profile'),
      productDescriptions: levelOf<ApiKeyWriteLevel>('productDescriptions'),
    } satisfies Record<ApiKeyFeature, z.ZodType>),
  });

// フォームが既定値を書き換えても共用の初期値に及ばないよう、毎回写しを作る
export const issueFormValues = (): ApiKeyFormValues => ({
  name: '',
  scopes: { ...DEFAULT_ISSUE_SCOPES },
});
