import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn, screen } from 'storybook/test';

import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import { ReasonField } from './reason-field.tsx';
import { REASON_SCHEMAS } from './reason-schema.ts';

const SCHEMAS = {
  required: z.object({ reason: REASON_SCHEMAS.required }),
  optional: z.object({ reason: REASON_SCHEMAS.optional }),
};

interface ReasonFormProps {
  readonly required: boolean;
}

function ReasonForm({ required }: ReasonFormProps) {
  const form = useAppForm(required ? SCHEMAS.required : SCHEMAS.optional, {
    defaultValues: { reason: '' },
  });
  return (
    <AppForm
      form={form}
      aria-label="停止の理由"
      onSubmit={fn()}
      onSubmitError={fn()}
      className="max-w-md"
    >
      <ReasonField control={form.control} name="reason" required={required} />
    </AppForm>
  );
}

const meta = {
  title: '管理画面/ReasonField',
  component: ReasonForm,
  args: { required: true },
} satisfies Meta<typeof ReasonForm>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Required: Story = {};

export const Optional: Story = {
  args: { required: false },
};

export const RequiredEmpty: Story = {
  play: async ({ userEvent }) => {
    await userEvent.click(
      await screen.findByRole('textbox', { name: '理由(必須)' }),
    );
    await userEvent.tab();
  },
};

export const TooLong: Story = {
  play: async ({ userEvent }) => {
    await userEvent.type(
      await screen.findByRole('textbox', { name: '理由(必須)' }),
      'あ'.repeat(501),
    );
    await userEvent.tab();
  },
};
