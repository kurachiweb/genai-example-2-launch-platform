import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { z } from '../../utilities/validation/zod.ts';
import { Checkbox } from '../ui/checkbox/checkbox.tsx';
import { Input } from '../ui/input/input.tsx';
import { AppForm } from './app-form.tsx';
import { FormField, type FormFieldLabelPlacement } from './form-field.tsx';
import { useAppForm } from './use-app-form.ts';

const AGREEMENT_NAME = '利用規約に同意し、18歳以上であることを表明する(必須)';
const AGREEMENT_REQUIRED = '利用規約に同意してください。';
const AGREEMENT_DESCRIPTION = '同意しないと登録できません。';
const NICKNAME_LABEL = 'ニックネーム';
const NARROW_PARENT_TEST_ID = 'narrow-parent';
const NARROW_PARENT_WIDTH = '288px';

const agreementSchema = z.object({
  nickname: z.string(),
  agreed: z.boolean().refine((value) => value, AGREEMENT_REQUIRED),
});

interface AgreementFormProps {
  readonly labelPlacement?: FormFieldLabelPlacement;
  readonly received?: string[];
}

function AgreementForm({ labelPlacement, received = [] }: AgreementFormProps) {
  const form = useAgreementForm();
  return (
    <AppForm
      form={form}
      onSubmit={() => undefined}
      onSubmitError={() => undefined}
      aria-label="同意の確認"
      className="flex flex-col gap-4"
    >
      <FormField control={form.control} name="nickname" label={NICKNAME_LABEL}>
        {(control) => <Input {...control} />}
      </FormField>
      <FormField
        control={form.control}
        name="agreed"
        labelPlacement={labelPlacement}
        description={AGREEMENT_DESCRIPTION}
        label={
          <span>
            <a href="/terms">利用規約</a>
            に同意し、18歳以上であることを表明する(必須)
          </span>
        }
      >
        {({ value, onChange, labelId, ...control }) => {
          received.push(labelId);
          return (
            <Checkbox
              {...control}
              checked={value}
              onCheckedChange={(checked) => {
                onChange(checked === true);
              }}
              aria-required
            />
          );
        }}
      </FormField>
    </AppForm>
  );
}

function useAgreementForm() {
  return useAppForm(agreementSchema, {
    defaultValues: { nickname: '', agreed: false },
  });
}

const agreement = () => page.getByRole('checkbox', { name: AGREEMENT_NAME });
const termsLink = () => page.getByRole('link', { name: '利用規約' });
const nicknameInput = () => page.getByRole('textbox', { name: NICKNAME_LABEL });

const fieldOf = (element: Element): Element => {
  const field = element.closest('[data-slot="form-field"]');
  if (field === null) {
    throw new Error('欄の要素が見つからない');
  }
  return field;
};

const labelOf = (field: Element): Element => {
  const label = field.querySelector('[data-slot="label"]');
  if (label === null) {
    throw new Error('ラベルの要素が見つからない');
  }
  return label;
};

const precedes = (before: Element, after: Element): boolean =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !==
  0;

async function showAgreementError(): Promise<void> {
  agreement().element().focus();
  await userEvent.keyboard('  ');
  await userEvent.tab();
  await expect.element(page.getByText(AGREEMENT_REQUIRED)).toBeVisible();
}

afterEach(() => {
  applyColorScheme('light');
});

describe('FormField', () => {
  test('既定ではラベルを入力欄より文書の前に置く', async () => {
    await render(<AgreementForm />);

    const checkbox = agreement().element();
    const label = labelOf(fieldOf(checkbox));

    expect(precedes(label, checkbox)).toBe(true);
  });

  describe('ラベルを入力欄の後に置くとき', () => {
    test('入力欄・ラベル・説明の順で文書に置き、ラベルを入力欄の右に並べる', async () => {
      await render(<AgreementForm labelPlacement="end" />);

      const checkbox = agreement().element();
      const label = labelOf(fieldOf(checkbox));
      const description = page.getByText(AGREEMENT_DESCRIPTION).element();

      expect(precedes(checkbox, label)).toBe(true);
      expect(precedes(label, description)).toBe(true);
      const checkboxBox = checkbox.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      expect(labelBox.left).toBeGreaterThanOrEqual(checkboxBox.right);
      expect(labelBox.top).toBeLessThan(checkboxBox.bottom);
    });

    test('Tabの順序は入力欄、ラベルの中のリンクの順になる', async () => {
      await render(<AgreementForm labelPlacement="end" />);

      nicknameInput().element().focus();
      await userEvent.tab();
      await expect.element(agreement()).toHaveFocus();
      await userEvent.tab();
      await expect.element(termsLink()).toHaveFocus();
    });

    test('ラベルで名前を付け、ラベルの要素のIDを子へ渡し、ラベルの押下で切り替わる', async () => {
      const received: string[] = [];
      await render(<AgreementForm labelPlacement="end" received={received} />);

      const label = labelOf(fieldOf(agreement().element()));
      expect(label.id).not.toBe('');
      expect(received.at(-1)).toBe(label.id);

      await userEvent.click(
        page.getByText('に同意し、18歳以上', { exact: false }),
      );

      await expect.element(agreement()).toBeChecked();
    });

    test('説明とエラーを入力欄に関連付け、エラーのある間は不正の状態を示す', async () => {
      await render(<AgreementForm labelPlacement="end" />);

      await expect
        .element(agreement())
        .toHaveAccessibleDescription(AGREEMENT_DESCRIPTION);
      await expect.element(agreement()).not.toHaveAttribute('aria-invalid');

      await showAgreementError();

      await expect.element(agreement()).toHaveAttribute('aria-invalid', 'true');
      await expect
        .element(agreement())
        .toHaveAccessibleDescription(
          `${AGREEMENT_DESCRIPTION} ${AGREEMENT_REQUIRED}`,
        );
    });

    test('幅を絞った親の中では長いラベルを折り返し、見える部分が親から溢れない', async () => {
      await render(
        <div
          data-testid={NARROW_PARENT_TEST_ID}
          style={{ width: NARROW_PARENT_WIDTH }}
        >
          <AgreementForm labelPlacement="end" />
        </div>,
      );
      await showAgreementError();
      const parent = page.getByTestId(NARROW_PARENT_TEST_ID).element();
      const field = fieldOf(agreement().element());
      const visibleParts = [
        agreement().element(),
        labelOf(field),
        page.getByText(AGREEMENT_DESCRIPTION).element(),
        page.getByText(AGREEMENT_REQUIRED).element(),
      ];

      for (const part of visibleParts) {
        const { left, right } = part.getBoundingClientRect();
        const bounds = parent.getBoundingClientRect();
        expect(left).toBeGreaterThanOrEqual(bounds.left);
        expect(right).toBeLessThanOrEqual(bounds.right);
      }
    });

    describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
      test('説明とエラーを表示した状態で、アクセシビリティの検査の違反が0件', async () => {
        applyColorScheme(scheme);
        const { container } = await render(
          <AgreementForm labelPlacement="end" />,
        );
        await showAgreementError();

        expect(await runAxe(container)).toStrictEqual([]);
      });
    });
  });
});
