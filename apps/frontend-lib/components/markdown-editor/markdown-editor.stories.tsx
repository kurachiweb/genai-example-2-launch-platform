import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { SubmitButton } from '../form/submit-button.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import {
  MarkdownEditor,
  type MarkdownEditorProps,
} from './markdown-editor.tsx';

const LABEL_ID = 'markdown-editor-story-label';

const DESCRIPTION_ID = 'markdown-editor-story-description';

const PREVIEW: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  idScope: 'preview',
};

const SAMPLE = [
  '## ローンチの感想',
  '',
  '**投票**の仕組みが分かりやすく、[要項](https://client.example/rules)も読みやすいです。',
  '',
  '- 良かった点',
  '- 気になった点',
  '',
  '| 項目 | 評価 |',
  '| --- | --- |',
  '| 使いやすさ | 高い |',
].join('\n');

function EditorStory({ value, onValueChange, ...props }: MarkdownEditorProps) {
  const [current, setCurrent] = useState(value);
  return (
    <div className="grid max-w-xl gap-2">
      <span id={LABEL_ID} className="text-sm font-medium">
        コメント
      </span>
      <MarkdownEditor
        {...props}
        value={current}
        onValueChange={(next) => {
          onValueChange(next);
          setCurrent(next);
        }}
      />
      <p id={DESCRIPTION_ID} className="text-sm text-muted-foreground">
        マークダウンで書けます。
      </p>
    </div>
  );
}

const COMMENT_MAX_GRAPHEMES = 2000;

const commentSchema = z.object({
  body: z
    .string()
    .refine((body) => body.trim() !== '', 'コメントを入力してください。')
    .refine(
      (body) => countGraphemes(body) <= COMMENT_MAX_GRAPHEMES,
      'コメントは2,000文字以内で入力してください。',
    ),
});

interface CommentFormProps {
  readonly onSubmit: (values: z.output<typeof commentSchema>) => void;
}

// FormFieldはAppFormの中に置き、子の関数が受け取る値を入力欄のpropsの名前へ対応付けて渡す。refはAppFormがエラーの欄へフォーカスを移す時に、labelIdは編集領域の名前に使う
function CommentForm({ onSubmit }: CommentFormProps) {
  const form = useAppForm(commentSchema, { defaultValues: { body: '' } });
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={() => undefined}
      aria-label="コメントの投稿"
      className="grid max-w-xl gap-4"
    >
      <FormField
        control={form.control}
        name="body"
        label="コメント(必須)"
        description="マークダウンで書けます。"
      >
        {(control) => (
          <MarkdownEditor
            value={control.value}
            onValueChange={control.onChange}
            onBlur={control.onBlur}
            ref={control.ref}
            labelId={control.labelId}
            describedById={control['aria-describedby']}
            invalid={control['aria-invalid'] === true}
            disabled={control.disabled === true}
            maxGraphemes={COMMENT_MAX_GRAPHEMES}
            placeholder="コメントを入力してください"
            preview={PREVIEW}
          />
        )}
      </FormField>
      <SubmitButton className="justify-self-start">投稿する</SubmitButton>
    </AppForm>
  );
}

const meta = {
  title: 'マークダウン/MarkdownEditor',
  component: MarkdownEditor,
  args: {
    value: SAMPLE,
    onValueChange: fn(),
    onBlur: fn(),
    labelId: LABEL_ID,
    describedById: DESCRIPTION_ID,
    maxGraphemes: 2000,
    placeholder: 'コメントを入力してください',
    preview: PREVIEW,
  },
  render: (args) => <EditorStory {...args} />,
} satisfies Meta<typeof MarkdownEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { value: '' },
};

export const OverLimit: Story = {
  args: { maxGraphemes: 100 },
};

export const Preview: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('tab', { name: 'プレビュー' }));
  },
};

export const EmptyPreview: Story = {
  args: { value: '' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('tab', { name: 'プレビュー' }));
  },
};

export const Invalid: Story = {
  args: { invalid: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithForm: Story = {
  render: () => <CommentForm onSubmit={fn()} />,
};
