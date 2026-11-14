import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { ClientProductHandleAvailabilityDocument } from '../../graphql/generated/graphql.ts';
import {
  fieldValuesOf,
  renderProductFields,
  submitButton,
  submittedFieldsOf,
  testForm,
} from './product-basic-fields-testing.tsx';
import { ProductHandleField } from './product-handle-field.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const HANDLE_REQUIRED = 'ハンドルを入力してください。';
const HANDLE_TOO_LONG = 'ハンドルは50文字以内で入力してください。';
const HANDLE_FORMAT =
  'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。';
const HANDLE_UNAVAILABLE =
  'このハンドルは既に使われています。別の文字列を入力してください。';
const PREVIOUS_HANDLE_GUIDANCE =
  '以前のハンドルold-notesは、次にハンドルを変更するか他のプロダクトが同じハンドルを設定するまで、新しいURLへ転送されます。';

const availability = (value: 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID') =>
  Promise.resolve({ ok: true, data: { productHandleAvailability: value } });

const availabilityCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientProductHandleAvailabilityDocument,
  );

const handleInput = () => page.getByRole('textbox', { name: 'ハンドル(必須)' });

async function fillAndBlur(value: string): Promise<void> {
  await userEvent.fill(handleInput(), value);
  await userEvent.tab();
}

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(() => availability('AVAILABLE'));
});

afterEach(() => {
  applyColorScheme('light');
});

describe('入力欄', () => {
  test('入力欄の前に接頭辞/p/を示し、接頭辞を含まない値を入力させる', async () => {
    await renderProductFields(
      <ProductHandleField previousHandle={null} disabled={false} />,
    );

    await expect.element(handleInput()).toHaveValue('pitch-notes');
    expect(
      testForm().element().querySelector('[data-slot="handle-prefix"]')
        ?.textContent,
    ).toBe('/p/');
  });

  test('FormFieldのdisabledで入力要素を無効にし、送る値から外す', async () => {
    const { onSubmit } = await renderProductFields(
      <ProductHandleField previousHandle={null} disabled />,
    );

    await expect.element(handleInput()).toBeDisabled();
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.handle).toBeUndefined();
  });
});

describe('フォーカスアウトの検証', () => {
  test.each([
    ['', HANDLE_REQUIRED],
    ['a'.repeat(51), HANDLE_TOO_LONG],
    ['-notes', HANDLE_FORMAT],
    ['pitch notes', HANDLE_FORMAT],
  ])(
    '形式の違反(%j)はその場で理由を示し、使用可否を問い合わせない',
    async (value, message) => {
      await renderProductFields(
        <ProductHandleField previousHandle={null} disabled={false} />,
      );

      await fillAndBlur(value);

      await expect.element(handleInput()).toHaveAccessibleDescription(message);
      await expect.element(handleInput()).toHaveAttribute('aria-invalid');
      expect(availabilityCalls()).toHaveLength(0);
    },
  );

  test('50文字のハンドルは形式を満たし、使用可否を問い合わせる', async () => {
    await renderProductFields(
      <ProductHandleField previousHandle={null} disabled={false} />,
    );

    await fillAndBlur('a'.repeat(50));

    await expect.poll(() => availabilityCalls().length).toBe(1);
    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
  });

  test('使用中のハンドルは、使用中の文言をその欄に示す', async () => {
    executeGraphQL.mockImplementation(() => availability('UNAVAILABLE'));
    await renderProductFields(
      <ProductHandleField previousHandle={null} disabled={false} />,
    );

    await fillAndBlur('taken-notes');

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(HANDLE_UNAVAILABLE);
    expect(availabilityCalls()[0]?.[1]).toEqual({ handle: 'taken-notes' });
  });

  test('使えるハンドルは、文言を出さない', async () => {
    await renderProductFields(
      <ProductHandleField previousHandle={null} disabled={false} />,
    );

    await fillAndBlur('free-notes');

    await expect.poll(() => availabilityCalls().length).toBe(1);
    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(handleInput()).not.toHaveAccessibleDescription();
  });

  test('編集では、編集中のプロダクトのハンドルを添えて問い合わせる', async () => {
    await renderProductFields(
      <ProductHandleField
        currentHandle="pitch-notes"
        previousHandle="old-notes"
        disabled={false}
      />,
    );

    await fillAndBlur('old-notes');

    await expect.poll(() => availabilityCalls().length).toBe(1);
    expect(availabilityCalls()[0]?.[1]).toEqual({
      handle: 'old-notes',
      productHandle: 'pitch-notes',
    });
  });

  test('編集で読み込んだ時点のハンドルのままなら、問い合わせない', async () => {
    await renderProductFields(
      <ProductHandleField
        currentHandle="pitch-notes"
        previousHandle={null}
        disabled={false}
      />,
    );

    await userEvent.click(handleInput());
    await userEvent.tab();

    expect(availabilityCalls()).toHaveLength(0);
  });

  test('応答を待つ間に値を変えた時は、古い応答の使用中の文言を捨てる', async () => {
    let resolveAvailability: (value: unknown) => void = () => undefined;
    executeGraphQL.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAvailability = resolve;
        }),
    );
    await renderProductFields(
      <ProductHandleField previousHandle={null} disabled={false} />,
    );

    await fillAndBlur('taken-notes');
    await expect.poll(() => availabilityCalls().length).toBe(1);
    await userEvent.fill(handleInput(), 'other-notes');
    resolveAvailability({
      ok: true,
      data: { productHandleAvailability: 'UNAVAILABLE' },
    });

    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
  });
});

describe('旧ハンドルの案内', () => {
  test('保持中の旧ハンドルがあれば、転送される旨を欄に結び付けて示す', async () => {
    await renderProductFields(
      <ProductHandleField
        currentHandle="pitch-notes"
        previousHandle="old-notes"
        disabled={false}
      />,
    );

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(PREVIOUS_HANDLE_GUIDANCE);
  });

  test('旧ハンドルが無ければ、案内を示さない', async () => {
    await renderProductFields(
      <ProductHandleField
        currentHandle="pitch-notes"
        previousHandle={null}
        disabled={false}
      />,
    );

    await expect.element(handleInput()).not.toHaveAccessibleDescription();
    expect(testForm().element().textContent).not.toContain('以前のハンドル');
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、旧ハンドルの案内と使用中の文言を示した状態の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      executeGraphQL.mockImplementation(() => availability('UNAVAILABLE'));
      await renderProductFields(
        <ProductHandleField
          currentHandle="pitch-notes"
          previousHandle="old-notes"
          disabled={false}
        />,
        fieldValuesOf(),
      );
      await fillAndBlur('taken-notes');
      await expect
        .element(testForm().getByText(HANDLE_UNAVAILABLE))
        .toBeVisible();

      expect(await runAxe(testForm().element())).toEqual([]);
    },
  );
});
