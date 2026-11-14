import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { page } from 'vitest/browser';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import {
  PRODUCT_HANDLE_MESSAGES,
  PRODUCT_HANDLE_RULE,
} from '../../../common-lib/product/product-input-rules.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import type { ProductBasicFieldValues } from './product-basic-field-values.ts';

export const CATEGORY_REQUIRED_MESSAGE = 'カテゴリを選択してください。';

// 基本の欄の部品だけを確かめるためのフォーム。ハンドルの形式は登録・編集のフォームと同じ規則と文言で検証する
const TEST_SCHEMA = z.object({
  fields: z.object({
    handle: z.string().superRefine((value, context) => {
      const message =
        PRODUCT_HANDLE_MESSAGES[checkHandleFormat(value, PRODUCT_HANDLE_RULE)];
      if (message !== undefined) {
        context.addIssue({ code: 'custom', message });
      }
    }),
    categoryId: z.string().min(1, CATEGORY_REQUIRED_MESSAGE).optional(),
    logoFileId: z.string().nullable(),
    screenshotFileIds: z.array(z.string()),
  }),
});

type TestFormInput = z.input<typeof TEST_SCHEMA>;

export type TestFormOutput = z.output<typeof TEST_SCHEMA>;

export type SubmitMock = ReturnType<
  typeof vi.fn<(values: TestFormOutput) => Promise<void>>
>;

export const TEST_FORM_LABEL = 'プロダクトの欄の確認';

export const TEST_SUBMIT_LABEL = '送信';

export const DEFAULT_FIELD_VALUES: ProductBasicFieldValues = Object.freeze({
  fields: {
    handle: 'pitch-notes',
    categoryId: '01JD0000000000000000000000',
    logoFileId: null,
    screenshotFileIds: [],
  },
});

export const fieldValuesOf = (
  overrides: Partial<ProductBasicFieldValues['fields']> = {},
): ProductBasicFieldValues => ({
  fields: { ...DEFAULT_FIELD_VALUES.fields, ...overrides },
});

interface TestFormProps {
  readonly defaultValues: ProductBasicFieldValues;
  readonly onSubmit: SubmitMock;
  readonly children: ReactNode;
}

function TestForm({ defaultValues, onSubmit, children }: TestFormProps) {
  const form = useAppForm<TestFormInput, TestFormOutput>(TEST_SCHEMA, {
    defaultValues,
  });
  return (
    <AppForm
      form={form}
      aria-label={TEST_FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={onSubmit}
      onSubmitError={() => undefined}
      className="flex flex-col gap-6 p-4"
    >
      {children}
      <SubmitButton className="self-start">{TEST_SUBMIT_LABEL}</SubmitButton>
    </AppForm>
  );
}

export interface ProductFieldsRenderOptions {
  // 画像を配信するオリジン。テストの開発サーバーから画像を配信する時に渡す
  readonly imagesOrigin?: string;
}

export async function renderProductFields(
  children: ReactNode,
  defaultValues: ProductBasicFieldValues = DEFAULT_FIELD_VALUES,
  onSubmit: SubmitMock = vi.fn(() => Promise.resolve()),
  { imagesOrigin }: ProductFieldsRenderOptions = {},
) {
  await renderInRouter(
    <TestForm defaultValues={defaultValues} onSubmit={onSubmit}>
      {children}
    </TestForm>,
    {
      path: '/my/products/new',
      context: createPageRouterContext(
        'local',
        imagesOrigin === undefined ? {} : { imagesOrigin },
      ),
    },
  );
  return { onSubmit };
}

export const testForm = () => page.getByRole('form', { name: TEST_FORM_LABEL });

export const submitButton = () =>
  page.getByRole('button', { name: TEST_SUBMIT_LABEL, exact: true });

export function fileInputOf(): HTMLInputElement {
  const input = testForm()
    .element()
    .querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}

export const submittedFieldsOf = (
  onSubmit: SubmitMock,
): TestFormOutput['fields'] | undefined => onSubmit.mock.calls[0]?.[0].fields;
