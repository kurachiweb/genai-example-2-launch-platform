import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import {
  errorMessageOf,
  GraphQLClientError,
} from '../../utilities/graphql/graphql-result.ts';
import { z } from '../../utilities/validation/zod.ts';
import { Input } from '../ui/input/input.tsx';
import { Textarea } from '../ui/textarea/textarea.tsx';
import { AppForm, type SubmitErrorContext } from './app-form.tsx';
import { FormField } from './form-field.tsx';
import { FormMessage } from './form-message.tsx';
import { SubmitButton } from './submit-button.tsx';
import { useAppForm } from './use-app-form.ts';

const productSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'プロダクト名を入力してください。')
    .max(40, 'プロダクト名は40文字以内で入力してください。'),
  url: z
    .string()
    .regex(
      /^https?:\/\/\S+$/,
      '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。',
    ),
  description: z
    .string()
    .max(200, '説明は200文字以内で入力してください。')
    .optional(),
});

type ProductInput = z.input<typeof productSchema>;

interface ProductFormProps {
  readonly onSubmit: (values: ProductInput) => Promise<void> | void;
  readonly onSubmitError: (error: unknown, context: SubmitErrorContext) => void;
  readonly contactAvailable: boolean;
  readonly descriptionLocked: boolean;
  readonly allLocked: boolean;
}

function ProductForm({
  onSubmit,
  onSubmitError,
  contactAvailable,
  descriptionLocked,
  allLocked,
}: ProductFormProps) {
  const form = useAppForm(productSchema, {
    defaultValues: { title: '', url: '', description: '' },
  });
  const [submitError, setSubmitError] = useState<string>();
  return (
    <AppForm
      form={form}
      onSubmit={async (values) => {
        setSubmitError(undefined);
        await onSubmit(values);
      }}
      onSubmitError={(error, context) => {
        setSubmitError(errorMessageOf(error, contactAvailable));
        onSubmitError(error, context);
      }}
      serverFieldPrefix="input"
      aria-label="プロダクトの投稿"
      className="flex max-w-md flex-col gap-4"
    >
      <FormField
        control={form.control}
        name="title"
        label="プロダクト名"
        disabled={allLocked}
        description="ディレクトリとプロダクトのページに表示されます。"
      >
        {(control) => <Input {...control} />}
      </FormField>
      <FormField
        control={form.control}
        name="url"
        label="外部WebサイトURL"
        disabled={allLocked}
      >
        {(control) => <Input type="url" {...control} />}
      </FormField>
      <FormField
        control={form.control}
        name="description"
        label="説明"
        disabled={allLocked || descriptionLocked}
      >
        {(control) => <Textarea {...control} />}
      </FormField>
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <SubmitButton className="self-start" disabled={allLocked}>
        投稿する
      </SubmitButton>
    </AppForm>
  );
}

const neverSettles = (): Promise<void> => new Promise<void>(() => undefined);

const meta = {
  title: 'フォーム/AppForm',
  component: ProductForm,
  args: {
    onSubmit: fn(),
    onSubmitError: fn(),
    contactAvailable: true,
    descriptionLocked: false,
    allLocked: false,
  },
} satisfies Meta<typeof ProductForm>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllFieldsDisabled: Story = {
  args: { allLocked: true },
};

export const DisabledField: Story = {
  args: { descriptionLocked: true },
};

export const ValidationError: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByLabelText('プロダクト名'));
    await userEvent.click(canvas.getByLabelText('外部WebサイトURL'));
    await userEvent.type(canvas.getByLabelText('外部WebサイトURL'), 'example');
    await userEvent.click(canvas.getByLabelText('説明'));
  },
};

export const Submitting: Story = {
  args: { onSubmit: fn(neverSettles) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByLabelText('プロダクト名'),
      'Launch Stadium',
    );
    await userEvent.type(
      canvas.getByLabelText('外部WebサイトURL'),
      'https://launch.example',
    );
    await userEvent.click(canvas.getByRole('button', { name: '投稿する' }));
  },
};

const submitValidProduct: NonNullable<Story['play']> = async ({
  canvas,
  userEvent,
}) => {
  await userEvent.type(canvas.getByLabelText('プロダクト名'), 'Launch Stadium');
  await userEvent.type(
    canvas.getByLabelText('外部WebサイトURL'),
    'https://launch.example',
  );
  await userEvent.click(canvas.getByRole('button', { name: '投稿する' }));
};

const rejectWithFieldErrors = (): Promise<void> =>
  Promise.reject(
    new GraphQLClientError({
      code: 'validation_failed',
      message: '入力内容を確認してください。',
      status: 400,
      details: [
        {
          field: 'input.title',
          message: 'このプロダクト名は既に使われています。',
          code: 'duplicated',
        },
        {
          field: 'input.url',
          message: '外部WebサイトURLに接続できませんでした。',
          code: 'unreachable',
        },
      ],
    }),
  );

export const ServerFieldError: Story = {
  args: { onSubmit: fn(rejectWithFieldErrors) },
  play: submitValidProduct,
};

export const ServerFieldErrorPartiallyFixed: Story = {
  args: { onSubmit: fn(rejectWithFieldErrors) },
  play: async (context) => {
    await submitValidProduct(context);
    const { canvas, userEvent } = context;
    await canvas.findByText('このプロダクト名は既に使われています。');
    const title = canvas.getByLabelText('プロダクト名');
    await userEvent.clear(title);
    await userEvent.type(title, 'Launch Stadium 2');
  },
};

const failUnexpectedly = (): Promise<void> =>
  Promise.reject(new Error('Cannot read properties of undefined'));

export const UnexpectedSubmitError: Story = {
  args: { onSubmit: fn(failUnexpectedly) },
  play: submitValidProduct,
};

export const UnexpectedSubmitErrorWithoutContact: Story = {
  args: { onSubmit: fn(failUnexpectedly), contactAvailable: false },
  play: submitValidProduct,
};
