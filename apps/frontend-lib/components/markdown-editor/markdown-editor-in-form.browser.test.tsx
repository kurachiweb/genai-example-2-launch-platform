import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import '../../styles/base.css';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import { MarkdownEditor } from './markdown-editor.tsx';

const LABEL = '本文';

const LINK_URL = 'https://client.example/rules';

const PREVIEW: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  idScope: 'preview',
};

const bodySchema = z.object({ body: z.string() });

interface BodyFormProps {
  readonly onSubmit: () => void;
}

function BodyForm({ onSubmit }: BodyFormProps) {
  const form = useAppForm(bodySchema, { defaultValues: { body: '' } });
  return (
    <AppForm
      form={form}
      onSubmit={onSubmit}
      onSubmitError={() => undefined}
      aria-label="投稿"
      className="grid gap-4 p-4"
    >
      <FormField control={form.control} name="body" label={LABEL}>
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
            maxGraphemes={2000}
            placeholder="本文を入力してください"
            preview={PREVIEW}
          />
        )}
      </FormField>
    </AppForm>
  );
}

const confirmations = [
  {
    name: '「設定」の押下',
    confirm: async () =>
      userEvent.click(page.getByRole('button', { name: '設定' })),
  },
  {
    name: 'URLの欄でのEnter',
    confirm: async () => userEvent.keyboard('{Enter}'),
  },
] as const;

describe('フォームの中に置いたマークダウンの入力欄', () => {
  test.each(confirmations)(
    'リンクのダイアログを$nameで確定すると、リンクを適用し、外側のフォームを送信しない',
    async ({ confirm }) => {
      const onSubmit = vi.fn<() => void>();
      await render(<BodyForm onSubmit={onSubmit} />);
      const editable = page.getByRole('textbox', { name: LABEL });
      await expect.element(editable).toBeInTheDocument();
      await expect
        .element(
          page.getByRole('toolbar', { name: '書式' }).getByRole('button', {
            name: '太字',
            exact: true,
          }),
        )
        .not.toHaveAttribute('disabled');
      const body = editable.element() as HTMLElement;
      await userEvent.click(body);
      await userEvent.keyboard('要項');
      await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');

      await userEvent.click(
        page
          .getByRole('toolbar', { name: '書式' })
          .getByRole('button', { name: 'リンク', exact: true }),
      );
      await userEvent.fill(
        page.getByRole('textbox', { name: 'URL' }),
        LINK_URL,
      );
      await confirm();

      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
      expect(body.querySelector('a')?.getAttribute('href')).toBe(LINK_URL);
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );
});
