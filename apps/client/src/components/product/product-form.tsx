import { type ReactNode, useId, useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import {
  type TurnstileTokenController,
  useTurnstileToken,
} from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import type { z } from '../../../lib/utilities/validation/zod.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ProductCategoryView } from '../../graphql/my-products.ts';
import { PRODUCT_BOT_ACTIONS } from './bot-actions.ts';
import { CategorySelect } from './category-select.tsx';
import {
  LaunchDateField,
  type LaunchDateFieldProps,
} from './launch-date-field.tsx';
import { LogoField, type LogoFieldCurrent } from './logo-field.tsx';
import type { ProductScreenshotEntry } from './product-basic-field-values.ts';
import { ProductDescriptionField } from './product-description-field.tsx';
import {
  BASIC_SECTION_HEADING,
  DESCRIPTION_SECTION_HEADING,
  EDIT_SUBMIT_LABEL,
  LAUNCH_DATE_SECTION_HEADING,
  NAME_FIELD_LABEL,
  REGISTER_SUBMIT_EMOJI,
  REGISTER_SUBMIT_LABEL,
  SCREENSHOTS_SECTION_HEADING,
  TAGLINE_FIELD_LABEL,
  WEBSITE_URL_FIELD_LABEL,
} from './product-form-messages.ts';
import type { ProductFormInput } from './product-form-schema.ts';
import { ProductHandleField } from './product-handle-field.tsx';
import { ScreenshotsField } from './screenshots-field.tsx';

// 編集で読み込んだプロダクトのうち、基本の欄が示す値
export interface ProductFormCurrent {
  readonly handle: string;
  readonly previousHandle: string | null;
  readonly logo: LogoFieldCurrent;
  readonly screenshots: readonly ProductScreenshotEntry[];
}

type LaunchDateTarget =
  | Omit<Extract<LaunchDateFieldProps, { kind: 'register' }>, 'disabled'>
  | Omit<Extract<LaunchDateFieldProps, { kind: 'edit' }>, 'disabled'>;

export interface ProductFormProps<TOutput> {
  // 計画の取り直しでローンチ日の欄の有無が変わる時は、呼び出し側が定数のスキーマを選び直して渡す
  readonly schema: z.ZodType<TOutput, ProductFormInput>;
  // フォームは初期値として受け取った時点の値を使う
  readonly defaultValues: ProductFormInput;
  readonly categories: readonly ProductCategoryView[];
  readonly launchDate: LaunchDateTarget;
  // 編集で読み込んだ値。登録では渡さない
  readonly current?: ProductFormCurrent;
  // カテゴリを変えられない理由。渡すとカテゴリの欄を無効にし、理由を欄に結び付けて示す
  readonly categoryDisabledReason?: string;
  // 真なら全欄と送信を無効にする
  readonly disabled: boolean;
  // フォームの名前にする見出しの要素のID
  readonly labelledBy: string;
  // 保存の送信。bot対策のトークンは、呼び出し側が`sendWithTurnstile`で取り出して送る
  readonly onSave: (
    values: TOutput,
    turnstile: TurnstileTokenController,
  ) => Promise<void>;
}

interface FormSectionProps {
  readonly heading: string;
  readonly children: ReactNode;
}

function FormSection({ heading, children }: FormSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} className="border-b pb-2 text-lg font-bold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

function SubmitLabel({ kind }: { readonly kind: LaunchDateTarget['kind'] }) {
  if (kind === 'edit') {
    return EDIT_SUBMIT_LABEL;
  }
  return (
    <>
      {REGISTER_SUBMIT_LABEL}
      <span aria-hidden="true">{REGISTER_SUBMIT_EMOJI}</span>
    </>
  );
}

// 登録と編集で共通のフォーム。見出し付きの区画を基本情報・説明文・スクリーンショット・ローンチ日の順に置き、末尾に送信のボタンを置く
export function ProductForm<TOutput>({
  schema,
  defaultValues,
  categories,
  launchDate,
  current,
  categoryDisabledReason,
  disabled,
  labelledBy,
  onSave,
}: ProductFormProps<TOutput>) {
  const [initialValues] = useState(defaultValues);
  const form = useAppForm<ProductFormInput, TOutput>(schema, {
    defaultValues: initialValues,
  });
  const turnstile = useTurnstileToken();
  const [submitError, setSubmitError] = useState<string>();

  return (
    <AppForm
      form={form}
      aria-labelledby={labelledBy}
      serverFieldPrefix="input"
      onSubmit={async (values) => {
        setSubmitError(undefined);
        await onSave(values, turnstile);
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-10"
    >
      <FormSection heading={BASIC_SECTION_HEADING}>
        <LogoField
          disabled={disabled}
          {...(current === undefined ? {} : { current: current.logo })}
        />
        <FormField
          control={form.control}
          name="fields.name"
          label={NAME_FIELD_LABEL}
          disabled={disabled}
        >
          {(control) => <Input {...control} aria-required />}
        </FormField>
        <FormField
          control={form.control}
          name="fields.tagline"
          label={TAGLINE_FIELD_LABEL}
          disabled={disabled}
        >
          {(control) => <Input {...control} aria-required />}
        </FormField>
        <CategorySelect
          categories={categories}
          disabled={disabled || categoryDisabledReason !== undefined}
          {...(categoryDisabledReason === undefined
            ? {}
            : { disabledReason: categoryDisabledReason })}
        />
        <ProductHandleField
          previousHandle={current?.previousHandle ?? null}
          disabled={disabled}
          {...(current === undefined ? {} : { currentHandle: current.handle })}
        />
        <FormField
          control={form.control}
          name="fields.websiteUrl"
          label={WEBSITE_URL_FIELD_LABEL}
          disabled={disabled}
        >
          {(control) => (
            <Input
              {...control}
              type="url"
              inputMode="url"
              autoComplete="url"
              aria-required
            />
          )}
        </FormField>
      </FormSection>
      <FormSection heading={DESCRIPTION_SECTION_HEADING}>
        <ProductDescriptionField disabled={disabled} />
      </FormSection>
      <FormSection heading={SCREENSHOTS_SECTION_HEADING}>
        <ScreenshotsField
          initial={current?.screenshots ?? []}
          disabled={disabled}
        />
      </FormSection>
      <FormSection heading={LAUNCH_DATE_SECTION_HEADING}>
        <LaunchDateField {...launchDate} disabled={disabled} />
      </FormSection>
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={PRODUCT_BOT_ACTIONS.save}
      />
      <div className="flex flex-col gap-3">
        {submitError === undefined ? null : (
          <FormMessage role="alert">{submitError}</FormMessage>
        )}
        <SubmitButton className="self-start" size="lg" disabled={disabled}>
          <SubmitLabel kind={launchDate.kind} />
        </SubmitButton>
      </div>
    </AppForm>
  );
}
