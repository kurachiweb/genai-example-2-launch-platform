import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  REASON_PERSONAL_INFORMATION_NOTICE,
  REASON_REQUIRED_MESSAGE,
  REASON_TOO_LONG_MESSAGE,
} from '../../utilities/messages/admin-console-messages.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { SubmitButton } from '../form/submit-button.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import { ReasonField } from './reason-field.tsx';
import { REASON_SCHEMAS } from './reason-schema.ts';

const FAMILY = '👨‍👩‍👧';

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
      onSubmit={() => undefined}
      onSubmitError={() => undefined}
      className="flex flex-col gap-4 p-4"
    >
      <ReasonField control={form.control} name="reason" required={required} />
      <SubmitButton>停止する</SubmitButton>
    </AppForm>
  );
}

const reasonBox = (name: string) =>
  page.getByRole('textbox', { name, exact: true });

afterEach(() => {
  applyColorScheme('light');
});

describe('ReasonField', () => {
  test('必須の欄は、名前に必須を添え、入力が必須であることを支援技術へ伝える', async () => {
    await render(<ReasonForm required />);
    const box = reasonBox('理由(必須)');

    await expect.element(box).toBeInTheDocument();
    await expect.element(box).toHaveAttribute('aria-required', 'true');
    expect(box.element().tagName).toBe('TEXTAREA');
  });

  test('任意の欄は、名前に任意を添え、入力を必須にしない', async () => {
    await render(<ReasonForm required={false} />);
    const box = reasonBox('理由(任意)');

    await expect.element(box).toBeInTheDocument();
    await expect.element(box).not.toHaveAttribute('aria-required');
  });

  test('欄の近くに個人情報を含めない旨を表示し、欄の説明として関連付ける', async () => {
    await render(<ReasonForm required />);

    await expect
      .element(page.getByText(REASON_PERSONAL_INFORMATION_NOTICE))
      .toBeVisible();
    await expect
      .element(reasonBox('理由(必須)'))
      .toHaveAccessibleDescription(REASON_PERSONAL_INFORMATION_NOTICE);
  });

  test('500文字を超える入力は、入力中にエラーを出さず、フォーカスを外した時点でエラーを示す', async () => {
    await render(<ReasonForm required={false} />);
    const box = reasonBox('理由(任意)');

    await box.fill('あ'.repeat(501));
    await expect.element(box).toHaveFocus();
    expect(page.getByText(REASON_TOO_LONG_MESSAGE).elements()).toHaveLength(0);

    await userEvent.tab();

    await expect.element(page.getByText(REASON_TOO_LONG_MESSAGE)).toBeVisible();
    await expect.element(box).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(box)
      .toHaveAccessibleDescription(
        `${REASON_PERSONAL_INFORMATION_NOTICE} ${REASON_TOO_LONG_MESSAGE}`,
      );
    await expect
      .element(page.getByRole('button', { name: '停止する' }))
      .toBeDisabled();
  });

  test('結合した絵文字を1文字と数え、500文字ちょうどはエラーにしない', async () => {
    await render(<ReasonForm required />);
    const box = reasonBox('理由(必須)');

    await box.fill(FAMILY.repeat(500));
    await userEvent.tab();

    await expect
      .element(page.getByRole('button', { name: '停止する' }))
      .toBeEnabled();
    expect(page.getByText(REASON_TOO_LONG_MESSAGE).elements()).toHaveLength(0);
    await expect.element(box).not.toHaveAttribute('aria-invalid');
  });

  test('必須の欄を空白だけにしてフォーカスを外すと、入力を求める文言を示す', async () => {
    await render(<ReasonForm required />);
    const box = reasonBox('理由(必須)');

    await box.fill(' 　');
    await userEvent.tab();

    await expect.element(page.getByText(REASON_REQUIRED_MESSAGE)).toBeVisible();
    await expect.element(box).toHaveAttribute('aria-invalid', 'true');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('上限を超えたエラーを表示した欄で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(<ReasonForm required />);
      await reasonBox('理由(必須)').fill('あ'.repeat(501));
      await userEvent.tab();
      await expect
        .element(page.getByText(REASON_TOO_LONG_MESSAGE))
        .toBeVisible();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
