import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import { z } from '../../utilities/validation/zod.ts';
import { Input } from '../ui/input/input.tsx';
import { Textarea } from '../ui/textarea/textarea.tsx';
import { AppForm, type SubmitErrorContext } from './app-form.tsx';
import { FormField } from './form-field.tsx';
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
  description: z.string().max(200, '説明は200文字以内で入力してください。'),
});

type ProductInput = z.input<typeof productSchema>;

interface ProductFormProps {
  readonly onSubmit: (values: ProductInput) => Promise<void> | void;
  readonly onSubmitError: (error: unknown, context: SubmitErrorContext) => void;
}

function ProductForm({ onSubmit, onSubmitError }: ProductFormProps) {
  const form = useAppForm(productSchema, {
    defaultValues: { title: '', url: '', description: '' },
  });
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={onSubmitError}
      serverFieldPrefix="input"
      aria-label="プロダクトの投稿"
      className="flex max-w-md flex-col gap-4"
    >
      <FormField
        control={form.control}
        name="title"
        label="プロダクト名"
        description="ディレクトリとプロダクトのページに表示されます。"
      >
        {(control) => <Input {...control} />}
      </FormField>
      <FormField control={form.control} name="url" label="外部WebサイトURL">
        {(control) => <Input type="url" {...control} />}
      </FormField>
      <FormField control={form.control} name="description" label="説明">
        {(control) => <Textarea {...control} />}
      </FormField>
      <SubmitButton className="self-start">投稿する</SubmitButton>
    </AppForm>
  );
}

const neverSettles = (): Promise<void> => new Promise<void>(() => undefined);

const meta = {
  title: 'フォーム/AppForm',
  component: ProductForm,
  args: { onSubmit: fn(), onSubmitError: fn() },
} satisfies Meta<typeof ProductForm>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

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

export const ServerFieldError: Story = {
  args: {
    onSubmit: fn(() =>
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
          ],
        }),
      ),
    ),
  },
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
