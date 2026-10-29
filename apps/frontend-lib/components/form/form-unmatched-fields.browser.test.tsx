import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { useFieldArray } from 'react-hook-form';
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
import { FormMessage } from './form-message.tsx';
import { SubmitButton } from './submit-button.tsx';
import { useAppForm } from './use-app-form.ts';

const TITLE_REQUIRED = 'プロダクト名を入力してください。';
const CITY_REQUIRED = '市区町村を入力してください。';
const CATEGORY_REQUIRED = 'カテゴリを選んでください。';
const CONTACT_TOO_SHORT = '連絡先は3文字以上で入力してください。';
const TITLE_DUPLICATED = 'このプロダクト名は既に使われています。';
const POSTAL_CODE_FORMAT =
  '郵便番号はハイフン無しの7桁の数字で入力してください。';
const POSTAL_CODE_REQUIRED = '郵便番号を入力してください。';
const PREFECTURE_REQUIRED = '都道府県を入力してください。';

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
  readonly locked?: boolean;
  readonly onSubmit?: SubmitHandler;
  readonly onSubmitError?: SubmitErrorHandler;
}

// 固定の期間に変えられない欄をFormFieldのdisabledで無効にする利用例
function LockedCategoryForm({
  rule,
  category,
  locked = true,
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
        disabled={locked}
      >
        {(control) => <Input {...control} />}
      </FormField>
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

interface ReportInput {
  title: string;
  contact?: string;
}

const withContactSchema: z.ZodType<ReportInput, ReportInput> = z.object({
  title: z.string().trim().min(1, TITLE_REQUIRED),
  contact: z.string().trim().min(3, CONTACT_TOO_SHORT),
});

const withoutContactSchema: z.ZodType<ReportInput, ReportInput> = z.object({
  title: z.string().trim().min(1, TITLE_REQUIRED),
});

interface ReportFormProps {
  readonly withContact: boolean;
  readonly onSubmit?: SubmitHandler;
  readonly onSubmitError?: SubmitErrorHandler;
}

// 条件で欄を描く・描かないと、条件ごとの定数のスキーマを切り替える利用例
function ReportForm({
  withContact,
  onSubmit = () => undefined,
  onSubmitError = () => undefined,
}: ReportFormProps) {
  const form = useAppForm(
    withContact ? withContactSchema : withoutContactSchema,
    { defaultValues: { title: '', contact: '' } },
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
      {withContact ? (
        <FormField control={form.control} name="contact" label="連絡先">
          {(control) => <Input {...control} />}
        </FormField>
      ) : null}
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

interface ShippingInput {
  postalCode: string;
  prefecture?: string;
}

const domesticSchema: z.ZodType<ShippingInput, ShippingInput> = z.object({
  postalCode: z.string().regex(/^\d{7}$/u, POSTAL_CODE_FORMAT),
  prefecture: z.string().trim().min(1, PREFECTURE_REQUIRED),
});

const overseasSchema: z.ZodType<ShippingInput, ShippingInput> = z.object({
  postalCode: z.string().trim().min(1, POSTAL_CODE_REQUIRED),
});

interface ShippingFormProps {
  readonly domestic: boolean;
  readonly onSubmit?: SubmitHandler;
}

// 条件で欄を描く・描かないと、描いたままの欄の規則も変わるスキーマを切り替える利用例
function ShippingForm({
  domestic,
  onSubmit = () => undefined,
}: ShippingFormProps) {
  const form = useAppForm(domestic ? domesticSchema : overseasSchema, {
    defaultValues: { postalCode: '', prefecture: '' },
  });
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={() => undefined}
      aria-label="配送先の登録"
    >
      <FormField control={form.control} name="postalCode" label="郵便番号">
        {(control) => <Input {...control} />}
      </FormField>
      {domestic ? (
        <FormField control={form.control} name="prefecture" label="都道府県">
          {(control) => <Input {...control} />}
        </FormField>
      ) : null}
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

const linksSchema = z.object({
  title: z.string().trim().min(1, TITLE_REQUIRED),
  links: z.array(z.object({ url: z.string() })),
});

interface LinksFormProps {
  readonly onSubmit: SubmitHandler;
  readonly onSubmitError: SubmitErrorHandler;
}

// rulesを持たない一覧を描く利用例
function LinksForm({ onSubmit, onSubmitError }: LinksFormProps) {
  const form = useAppForm(linksSchema, {
    defaultValues: { title: '', links: [{ url: '' }] },
  });
  useFieldArray({ control: form.control, name: 'links' });
  const linksError = form.formState.errors.links?.message;
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
      <FormField control={form.control} name="links.0.url" label="リンク">
        {(control) => <Input {...control} />}
      </FormField>
      {linksError === undefined ? null : (
        <FormMessage>{linksError}</FormMessage>
      )}
      <SubmitButton>登録する</SubmitButton>
    </AppForm>
  );
}

const titleInput = () => page.getByRole('textbox', { name: 'プロダクト名' });
const contactInput = () => page.getByRole('textbox', { name: '連絡先' });
const cityInput = () => page.getByRole('textbox', { name: '市区町村' });
const categoryInput = () => page.getByRole('textbox', { name: 'カテゴリ' });
const postalCodeInput = () => page.getByRole('textbox', { name: '郵便番号' });
const prefectureInput = () => page.getByRole('textbox', { name: '都道府県' });
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

  describe('後から無効にした欄', () => {
    test('検証のエラーが付いた欄を後から無効にすると、エラーの表示を消し、他の欄が正しければ送信ボタンを有効にする', async () => {
      const screen = await render(
        <LockedCategoryForm rule="required" category="" locked={false} />,
      );
      await userEvent.fill(titleInput(), 'Pitch Notes');
      await userEvent.click(categoryInput());
      await userEvent.tab();
      await expect.element(page.getByText(CATEGORY_REQUIRED)).toBeVisible();
      await expect.element(submitButton()).toBeDisabled();

      await screen.rerender(
        <LockedCategoryForm rule="required" category="" locked />,
      );

      await expect.element(categoryInput()).toBeDisabled();
      await expect
        .element(page.getByText(CATEGORY_REQUIRED))
        .not.toBeInTheDocument();
      await expect.element(categoryInput()).not.toHaveAttribute('aria-invalid');
      await expect.element(submitButton()).toBeEnabled();
    });

    test('サーバーのエラーが付いた欄を後から無効にすると、エラーの表示を消し、他の欄が正しければ送信ボタンを有効にする', async () => {
      const categoryDetail = {
        field: 'input.category',
        code: 'unavailable',
        message: 'このカテゴリは選べません。',
      };
      const onSubmit = () => {
        throw validationError([categoryDetail]);
      };
      const onSubmitError = vi.fn();
      const screen = await render(
        <LockedCategoryForm
          rule="required"
          category=""
          locked={false}
          onSubmit={onSubmit}
          onSubmitError={onSubmitError}
        />,
      );
      await userEvent.fill(titleInput(), 'Pitch Notes');
      await userEvent.fill(categoryInput(), 'gadgets');
      await userEvent.click(submitButton());
      await expect
        .element(page.getByText(categoryDetail.message))
        .toBeVisible();
      await expect.element(submitButton()).toBeDisabled();

      await screen.rerender(
        <LockedCategoryForm
          rule="required"
          category=""
          locked
          onSubmit={onSubmit}
          onSubmitError={onSubmitError}
        />,
      );

      await expect
        .element(page.getByText(categoryDetail.message))
        .not.toBeInTheDocument();
      await expect.element(submitButton()).toBeEnabled();
      expect(onSubmitError).not.toHaveBeenCalled();
    });
  });

  describe('スキーマの切り替え', () => {
    test('描いていた欄に検証のエラーを出した後に描かない条件へ切り替えると、新しいスキーマの結果で送信ボタンを有効にし、送信できる', async () => {
      const onSubmit = vi.fn<SubmitHandler>();
      const screen = await render(
        <ReportForm withContact onSubmit={onSubmit} />,
      );
      await userEvent.fill(titleInput(), 'Pitch Notes');
      await userEvent.fill(contactInput(), 'ab');
      await userEvent.tab();
      await expect.element(page.getByText(CONTACT_TOO_SHORT)).toBeVisible();
      await expect.element(submitButton()).toBeDisabled();

      await screen.rerender(
        <ReportForm withContact={false} onSubmit={onSubmit} />,
      );

      await expect.element(contactInput()).not.toBeInTheDocument();
      await expect.element(submitButton()).toBeEnabled();

      await userEvent.click(submitButton());

      await expect.poll(() => onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls).toStrictEqual([[{ title: 'Pitch Notes' }]]);
    });

    test('切り替えると、描かれている欄に表示中の検証のエラーを新しい規則の結果に置き換え、新しい規則で正しければ消して送信ボタンを有効にし、送信できる', async () => {
      const onSubmit = vi.fn<SubmitHandler>();
      const screen = await render(
        <ShippingForm domestic onSubmit={onSubmit} />,
      );
      await userEvent.fill(postalCodeInput(), 'SW1A 1AA');
      await userEvent.click(prefectureInput());
      await userEvent.tab();
      await expect.element(page.getByText(POSTAL_CODE_FORMAT)).toBeVisible();
      await expect.element(page.getByText(PREFECTURE_REQUIRED)).toBeVisible();
      await expect.element(submitButton()).toBeDisabled();

      await screen.rerender(
        <ShippingForm domestic={false} onSubmit={onSubmit} />,
      );

      await expect.element(prefectureInput()).not.toBeInTheDocument();
      await expect
        .element(page.getByText(POSTAL_CODE_FORMAT))
        .not.toBeInTheDocument();
      await expect
        .element(postalCodeInput())
        .not.toHaveAttribute('aria-invalid');
      await expect.element(submitButton()).toBeEnabled();

      await userEvent.click(submitButton());

      await expect.poll(() => onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls).toStrictEqual([[{ postalCode: 'SW1A 1AA' }]]);
    });

    test('切り替えると、描かれている欄に表示中の検証のエラーが新しい規則でも残る場合は、新しい規則の文言にする', async () => {
      const screen = await render(<ShippingForm domestic />);
      await userEvent.click(postalCodeInput());
      await userEvent.tab();
      await expect.element(page.getByText(POSTAL_CODE_FORMAT)).toBeVisible();

      await screen.rerender(<ShippingForm domestic={false} />);

      await expect.element(page.getByText(POSTAL_CODE_REQUIRED)).toBeVisible();
      await expect
        .element(page.getByText(POSTAL_CODE_FORMAT))
        .not.toBeInTheDocument();
      await expect.element(postalCodeInput()).toHaveAttribute('aria-invalid');
      await expect.element(submitButton()).toBeDisabled();

      await userEvent.fill(postalCodeInput(), 'SW1A 1AA');

      await expect
        .element(page.getByText(POSTAL_CODE_REQUIRED))
        .not.toBeInTheDocument();
      await expect.element(submitButton()).toBeEnabled();
    });

    test('切り替えても、描かれている欄のサーバーのエラーは残し、その欄を直すまで送信ボタンを無効にする', async () => {
      const onSubmit = () => {
        throw validationError([
          {
            field: 'input.title',
            code: 'duplicated',
            message: TITLE_DUPLICATED,
          },
        ]);
      };
      const screen = await render(
        <ReportForm withContact onSubmit={onSubmit} />,
      );
      await userEvent.fill(titleInput(), 'Pitch Notes');
      await userEvent.fill(contactInput(), 'pitch-notes@mail.example');
      await userEvent.click(submitButton());
      await expect.element(page.getByText(TITLE_DUPLICATED)).toBeVisible();

      await screen.rerender(
        <ReportForm withContact={false} onSubmit={onSubmit} />,
      );

      await expect.element(contactInput()).not.toBeInTheDocument();
      await expect.element(page.getByText(TITLE_DUPLICATED)).toBeVisible();
      await expect.element(submitButton()).toBeDisabled();

      await userEvent.fill(titleInput(), 'Pitch Notes 2');

      await expect
        .element(page.getByText(TITLE_DUPLICATED))
        .not.toBeInTheDocument();
      await expect.element(submitButton()).toBeEnabled();
    });
  });

  describe('描かれていない欄', () => {
    const contactDetail = {
      field: 'input.contact',
      code: 'required',
      message: '連絡先を入力してください。',
    };

    test.each([
      { state: '一度も描いていない', initiallyShown: false },
      { state: '描いた後に描かなくなった', initiallyShown: true },
    ])(
      '$state欄の詳細は、欄に付けず送信の失敗として渡し、送信ボタンを有効のままにする',
      async ({ initiallyShown }) => {
        const failure = validationError([contactDetail]);
        const onSubmit = () => {
          throw failure;
        };
        const onSubmitError = vi.fn();
        const screen = await render(
          <ReportForm
            withContact={initiallyShown}
            onSubmit={onSubmit}
            onSubmitError={onSubmitError}
          />,
        );
        if (initiallyShown) {
          await userEvent.fill(contactInput(), 'pitch-notes@mail.example');
          await screen.rerender(
            <ReportForm
              withContact={false}
              onSubmit={onSubmit}
              onSubmitError={onSubmitError}
            />,
          );
        }
        await userEvent.fill(titleInput(), 'Pitch Notes');

        await userEvent.click(submitButton());

        await expect.poll(() => onSubmitError).toHaveBeenCalledTimes(1);
        expect(onSubmitError).toHaveBeenLastCalledWith(failure, {
          unmatched: [{ ...contactDetail, field: 'contact' }],
        });
        await expect.element(titleInput()).not.toHaveAttribute('aria-invalid');
        await expect.element(submitButton()).toBeEnabled();
      },
    );

    test('rulesを持たない一覧を描いている間は、一覧の経路そのものの詳細を欄のエラーにする', async () => {
      const linksDetail = {
        field: 'input.links',
        code: 'too_many',
        message: 'リンクは5件以内で入力してください。',
      };
      const onSubmitError = vi.fn();
      await render(
        <LinksForm
          onSubmit={() => {
            throw validationError([linksDetail]);
          }}
          onSubmitError={onSubmitError}
        />,
      );
      await userEvent.fill(titleInput(), 'Pitch Notes');

      await userEvent.click(submitButton());

      await expect.element(page.getByText(linksDetail.message)).toBeVisible();
      expect(onSubmitError).not.toHaveBeenCalled();
    });
  });
});
