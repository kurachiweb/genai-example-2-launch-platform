import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import {
  type FieldErrorDetail,
  GraphQLClientError,
} from '../../utilities/graphql/graphql-result.ts';
import { z } from '../../utilities/validation/zod.ts';
import { Input } from '../ui/input/input.tsx';
import { AppForm, type SubmitErrorContext } from './app-form.tsx';
import { FormField } from './form-field.tsx';
import { SubmitButton } from './submit-button.tsx';
import { useAppForm } from './use-app-form.ts';

const TITLE_REQUIRED = 'プロダクト名を入力してください。';
const CITY_REQUIRED = '市区町村を入力してください。';
const CATEGORY_REQUIRED = 'カテゴリを選んでください。';

type SubmitHandler = (values: unknown) => Promise<void> | void;
type SubmitErrorHandler = (error: unknown, context: SubmitErrorContext) => void;

const addressSchema = z.object({
  title: z.string().trim().min(1, TITLE_REQUIRED),
  address: z.object({ city: z.string().trim().min(1, CITY_REQUIRED) }),
});

interface AddressFormProps {
  readonly onSubmit: SubmitHandler;
  readonly onSubmitError: SubmitErrorHandler;
}

function AddressForm({ onSubmit, onSubmitError }: AddressFormProps) {
  const form = useAppForm(addressSchema, {
    defaultValues: { title: '', address: { city: '' } },
  });
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={onSubmitError}
      serverFieldPrefix="input"
      aria-label="プロダクトの登録"
    >
      <FormField control={form.control} name="title" label="プロダクト名">
        {(control) => <Input {...control} />}
      </FormField>
      <FormField control={form.control} name="address.city" label="市区町村">
        {(control) => <Input {...control} />}
      </FormField>
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

const optionalCategorySchema = z.object({
  title: z.string().trim().min(1, TITLE_REQUIRED),
  category: z.string().min(1, CATEGORY_REQUIRED).optional(),
});

const requiredCategorySchema = z.object({
  title: z.string().trim().min(1, TITLE_REQUIRED),
  category: z.string().min(1, CATEGORY_REQUIRED),
});

type CategoryRule = 'optional' | 'required';

interface LockedCategoryFormProps {
  readonly rule: CategoryRule;
  readonly category: string;
  readonly onSubmit?: SubmitHandler;
  readonly onSubmitError?: SubmitErrorHandler;
}

// 固定の期間に変えられない欄をFormFieldのdisabledで無効にする利用例
function LockedCategoryForm({
  rule,
  category,
  onSubmit = () => undefined,
  onSubmitError = () => undefined,
}: LockedCategoryFormProps) {
  const form = useAppForm(
    rule === 'optional' ? optionalCategorySchema : requiredCategorySchema,
    { defaultValues: { title: '', category } },
  );
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={onSubmitError}
      serverFieldPrefix="input"
      aria-label="プロダクトの登録"
    >
      <FormField control={form.control} name="title" label="プロダクト名">
        {(control) => <Input {...control} />}
      </FormField>
      <FormField
        control={form.control}
        name="category"
        label="カテゴリ"
        disabled
      >
        {(control) => <Input {...control} />}
      </FormField>
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

const titleInput = () => page.getByRole('textbox', { name: 'プロダクト名' });
const cityInput = () => page.getByRole('textbox', { name: '市区町村' });
const categoryInput = () => page.getByRole('textbox', { name: 'カテゴリ' });
const submitButton = () =>
  page.getByRole('button', { name: '登録する', exact: true });

function validationError(
  details: readonly FieldErrorDetail[],
): GraphQLClientError {
  return new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容に誤りがあります。',
    status: 400,
    details,
  });
}

describe('フォーム部品の欄に対応しない経路', () => {
  test('サーバーの詳細が欄をまとめた値の経路に付くと、欄に付けず送信の失敗として渡し、送信ボタンを有効のままにする', async () => {
    const addressDetail = {
      field: 'input.address',
      code: 'unsupported_region',
      message: '配送できない地域です。',
    };
    const failure = validationError([addressDetail]);
    const onSubmitError = vi.fn();
    await render(
      <AddressForm
        onSubmit={() => {
          throw failure;
        }}
        onSubmitError={onSubmitError}
      />,
    );
    await userEvent.fill(titleInput(), 'Pitch Notes');
    await userEvent.fill(cityInput(), '渋谷区');

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmitError).toHaveBeenCalledTimes(1);
    expect(onSubmitError).toHaveBeenLastCalledWith(failure, {
      unmatched: [{ ...addressDetail, field: 'address' }],
    });
    await expect.element(titleInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(cityInput()).not.toHaveAttribute('aria-invalid');
    await expect
      .element(page.getByText(addressDetail.message))
      .not.toBeInTheDocument();
    await expect.element(submitButton()).toBeEnabled();
  });

  describe('無効の欄', () => {
    test('FormFieldのdisabledで無効にした欄の詳細は、欄に付けず送信の失敗として渡し、無効の欄の値を送信の値に含めない', async () => {
      const categoryDetail = {
        field: 'input.category',
        code: 'locked',
        message: 'カテゴリは変更できません。',
      };
      const failure = validationError([categoryDetail]);
      const onSubmit = vi.fn<SubmitHandler>(() => {
        throw failure;
      });
      const onSubmitError = vi.fn();
      await render(
        <LockedCategoryForm
          rule="optional"
          category="gadgets"
          onSubmit={onSubmit}
          onSubmitError={onSubmitError}
        />,
      );
      await expect.element(categoryInput()).toBeDisabled();
      await userEvent.fill(titleInput(), 'Pitch Notes');

      await userEvent.click(submitButton());

      await expect.poll(() => onSubmitError).toHaveBeenCalledTimes(1);
      expect(onSubmitError).toHaveBeenLastCalledWith(failure, {
        unmatched: [{ ...categoryDetail, field: 'category' }],
      });
      expect(onSubmit.mock.calls).toStrictEqual([[{ title: 'Pitch Notes' }]]);
      await expect.element(categoryInput()).not.toHaveAttribute('aria-invalid');
      await expect
        .element(page.getByText(categoryDetail.message))
        .not.toBeInTheDocument();
      await expect.element(submitButton()).toBeEnabled();
    });

    test('任意にした無効の欄の値がスキーマを通らなくても、他の欄を正しく入力すると送信でき、変換を通った値を渡す', async () => {
      const onSubmit = vi.fn<SubmitHandler>();
      await render(
        <LockedCategoryForm rule="optional" category="" onSubmit={onSubmit} />,
      );
      await expect.element(submitButton()).toBeDisabled();

      await userEvent.fill(titleInput(), '  Pitch Notes  ');

      await expect.element(submitButton()).toBeEnabled();

      await userEvent.click(submitButton());

      await expect.poll(() => onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls).toStrictEqual([[{ title: 'Pitch Notes' }]]);
      await expect
        .element(page.getByText(CATEGORY_REQUIRED))
        .not.toBeInTheDocument();
    });

    test('無効の欄を任意にしないスキーマでも、無効の欄の検証エラーで送信ボタンを無効のまま残さず送信できる', async () => {
      const onSubmit = vi.fn<SubmitHandler>();
      await render(
        <LockedCategoryForm rule="required" category="" onSubmit={onSubmit} />,
      );

      await userEvent.fill(titleInput(), 'Pitch Notes');

      await expect.element(submitButton()).toBeEnabled();

      await userEvent.click(submitButton());

      await expect.poll(() => onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls).toStrictEqual([[{ title: 'Pitch Notes' }]]);
      await expect
        .element(page.getByText(CATEGORY_REQUIRED))
        .not.toBeInTheDocument();
    });

    test.each<CategoryRule>(['optional', 'required'])(
      '無効の欄のスキーマが%sでも、欄の再検証の後に送信ボタンが無効に戻らない',
      async (rule) => {
        await render(<LockedCategoryForm rule={rule} category="" />);
        await userEvent.fill(titleInput(), 'Pitch Notes');
        await userEvent.tab();
        await expect.element(submitButton()).toBeEnabled();

        await userEvent.fill(titleInput(), '');

        await expect.element(page.getByText(TITLE_REQUIRED)).toBeVisible();
        await expect.element(submitButton()).toBeDisabled();

        await userEvent.fill(titleInput(), 'Pitch Notes 2');

        await expect
          .element(page.getByText(TITLE_REQUIRED))
          .not.toBeInTheDocument();
        await expect.element(submitButton()).toBeEnabled();
      },
    );
  });
});
