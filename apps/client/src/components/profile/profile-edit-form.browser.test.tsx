import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ClientHandleAvailabilityDocument } from '../../graphql/generated/graphql.ts';
import {
  handleInput,
  headlineInput,
  myProfileOf,
  nicknameInput,
  profileForm,
  renderProfileEditForm,
  saveButton,
} from './profile-edit-form-testing.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const NICKNAME_REQUIRED = 'ニックネームを入力してください。';
const NICKNAME_TOO_LONG = 'ニックネームは25文字以内で入力してください。';
const HANDLE_REQUIRED = 'ハンドルを入力してください。';
const HANDLE_TOO_LONG = 'ハンドルは25文字以内で入力してください。';
const HANDLE_FORMAT =
  'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。';
const HANDLE_UNAVAILABLE =
  'このハンドルは既に使われています。別の文字列を入力してください。';
const HEADLINE_FORBIDDEN = 'ヘッドラインに使用できない文字が含まれています。';
const HEADLINE_TOO_LONG = 'ヘッドラインは50文字以内で入力してください。';

const availability = (value: 'AVAILABLE' | 'UNAVAILABLE' | 'INVALID') =>
  Promise.resolve({ ok: true, data: { handleAvailability: value } });

const availabilityCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientHandleAvailabilityDocument,
  );

const blur = () => userEvent.tab();

async function fillAndBlur(
  input: ReturnType<typeof nicknameInput>,
  value: string,
): Promise<void> {
  await userEvent.fill(input, value);
  await blur();
}

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(() => availability('AVAILABLE'));
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('初期表示', () => {
  test('現在のニックネーム・ハンドル・ヘッドラインを入力欄に表示し、欄の順に並べる', async () => {
    await renderProfileEditForm(
      myProfileOf({ headline: '個人開発者', bio: '自己紹介の本文' }),
    );

    await expect.element(nicknameInput()).toHaveValue('ピッチの作り手');
    await expect.element(handleInput()).toHaveValue('maker_ai');
    await expect.element(headlineInput()).toHaveValue('個人開発者');
    await expect
      .element(page.getByRole('textbox', { name: '自己紹介' }))
      .toHaveTextContent('自己紹介の本文');
    const labels = profileForm()
      .element()
      .querySelectorAll('[data-slot="form-field"] > label');
    expect(Array.from(labels, (label) => label.textContent)).toEqual([
      'プロフィール画像',
      'ニックネーム(必須)',
      'ハンドル(必須)',
      'ヘッドライン',
      '自己紹介',
    ]);
  });

  test('保存の送信ボタンを有効にして描き、bot対策の判定の枠や失敗の文言を出さない', async () => {
    await renderProfileEditForm();

    await expect.element(saveButton()).toBeEnabled();
    expect(profileForm().element().querySelector('[role="alert"]')).toBeNull();
  });

  test.each(COLOR_SCHEMES)(
    '%sでアクセシビリティの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderProfileEditForm(
        myProfileOf({
          headline: '個人開発者',
          previousHandle: 'old_handle',
          websites: [{ name: '個人サイト', url: 'https://maker.example/' }],
        }),
      );
      await expect
        .element(page.getByRole('textbox', { name: '自己紹介' }))
        .toBeInTheDocument();

      expect(await runAxe(document.body)).toEqual([]);
    },
  );

  test('各欄の検証の文言を出した状態でもアクセシビリティの違反が0件である', async () => {
    await renderProfileEditForm();

    await fillAndBlur(nicknameInput(), '');
    await fillAndBlur(handleInput(), 'bad handle');
    await fillAndBlur(headlineInput(), 'あ'.repeat(51));
    await expect
      .element(headlineInput())
      .toHaveAccessibleDescription(HEADLINE_TOO_LONG);

    expect(await runAxe(document.body)).toEqual([]);
  });
});

describe('フォーカスアウトでの検証', () => {
  test.each([
    ['ニックネームが空', nicknameInput, '', NICKNAME_REQUIRED],
    ['ニックネームが26文字', nicknameInput, 'あ'.repeat(26), NICKNAME_TOO_LONG],
    ['ハンドルが空', handleInput, '', HANDLE_REQUIRED],
    ['ハンドルが26文字', handleInput, 'a'.repeat(26), HANDLE_TOO_LONG],
    ['ハンドルが記号で始まる', handleInput, '-maker', HANDLE_FORMAT],
    ['ハンドルに空白を含む', handleInput, 'maker ai', HANDLE_FORMAT],
    ['ヘッドラインが51文字', headlineInput, 'あ'.repeat(51), HEADLINE_TOO_LONG],
    [
      'ヘッドラインに使用できない文字を含む',
      headlineInput,
      '開発者\u0007',
      HEADLINE_FORBIDDEN,
    ],
  ])(
    '%sなら、フォーカスを外すとその欄に文言を示す',
    async (_name, input, value, message) => {
      await renderProfileEditForm();

      await userEvent.fill(input(), value);
      await expect.element(input()).not.toHaveAttribute('aria-invalid');
      await blur();

      await expect.element(input()).toHaveAccessibleDescription(message);
      await expect.element(input()).toHaveAttribute('aria-invalid', 'true');
      await expect.element(saveButton()).toBeDisabled();
    },
  );

  test('直すと文言が消え、保存できる状態に戻る', async () => {
    await renderProfileEditForm();
    await fillAndBlur(nicknameInput(), '');
    await expect
      .element(nicknameInput())
      .toHaveAccessibleDescription(NICKNAME_REQUIRED);

    await userEvent.fill(nicknameInput(), '新しい名前');

    await expect.element(nicknameInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(saveButton()).toBeEnabled();
  });

  test('前後の空白を除いて25文字のニックネームと50文字のヘッドラインは受け付ける', async () => {
    await renderProfileEditForm();

    await fillAndBlur(nicknameInput(), ` ${'あ'.repeat(25)} `);
    await fillAndBlur(headlineInput(), `\u3000${'あ'.repeat(50)}\u3000`);

    await expect.element(nicknameInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(headlineInput()).not.toHaveAttribute('aria-invalid');
  });
});

describe('ハンドルの使用可否の確認', () => {
  test('使用中のハンドルなら、フォーカスを外すと使用中の文言を示し、保存を無効にする', async () => {
    executeGraphQL.mockImplementation(() => availability('UNAVAILABLE'));
    await renderProfileEditForm();

    await fillAndBlur(handleInput(), 'taken_name');

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(HANDLE_UNAVAILABLE);
    await expect.element(handleInput()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(saveButton()).toBeDisabled();
    expect(availabilityCalls()).toHaveLength(1);
    expect(availabilityCalls()[0]?.[1]).toEqual({ handle: 'taken_name' });
  });

  test('使えるハンドルには、肯定の表示を出さず文言も出さない', async () => {
    await renderProfileEditForm();

    await fillAndBlur(handleInput(), 'free_name');

    await expect.poll(() => availabilityCalls().length).toBe(1);
    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(handleInput()).not.toHaveAccessibleDescription();
    await expect.element(saveButton()).toBeEnabled();
  });

  test('使用中の文言は、ハンドルを直すと消える', async () => {
    executeGraphQL.mockImplementation(() => availability('UNAVAILABLE'));
    await renderProfileEditForm();
    await fillAndBlur(handleInput(), 'taken_name');
    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(HANDLE_UNAVAILABLE);

    await userEvent.fill(handleInput(), 'taken_name2');

    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
  });

  test('形式の違反は、使用可否を問い合わせずに形式の文言を示す', async () => {
    await renderProfileEditForm();

    await fillAndBlur(handleInput(), 'bad handle');

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(HANDLE_FORMAT);
    expect(availabilityCalls()).toHaveLength(0);
  });

  test('読み込んだ時点のハンドルのままなら、問い合わせない', async () => {
    await renderProfileEditForm();

    await userEvent.click(handleInput());
    await blur();

    expect(availabilityCalls()).toHaveLength(0);
  });

  test('大文字小文字だけを変えたハンドルは、問い合わせる', async () => {
    await renderProfileEditForm();

    await fillAndBlur(handleInput(), 'Maker_AI');

    await expect.poll(() => availabilityCalls().length).toBe(1);
  });

  test('応答を待つ間に値を変えた時は、古い応答の使用中の文言を捨てる', async () => {
    let resolveAvailability: (value: unknown) => void = () => undefined;
    executeGraphQL.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAvailability = resolve;
        }),
    );
    await renderProfileEditForm();

    await fillAndBlur(handleInput(), 'taken_name');
    await expect.poll(() => availabilityCalls().length).toBe(1);
    await userEvent.fill(handleInput(), 'other_name');
    resolveAvailability({
      ok: true,
      data: { handleAvailability: 'UNAVAILABLE' },
    });

    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(saveButton()).toBeEnabled();
  });

  test('想定内の失敗は文言を出さずに送信を続けさせ、想定外の失敗はエラートラッキングへ送る', async () => {
    executeGraphQL.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        error: new GraphQLClientError({
          code: 'rate_limited',
          message: '短時間に操作が集中しています。',
          status: 429,
        }),
      }),
    );
    await renderProfileEditForm();

    await fillAndBlur(handleInput(), 'free_name');
    await expect.poll(() => availabilityCalls().length).toBe(1);

    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();

    const failure = new TypeError('Failed to fetch');
    executeGraphQL.mockImplementationOnce(() => Promise.reject(failure));
    await fillAndBlur(handleInput(), 'free_name2');

    await expect
      .poll(() => reportUnexpectedErrorInBrowser)
      .toHaveBeenCalledWith(failure, 'render');
    await expect.element(handleInput()).not.toHaveAttribute('aria-invalid');
  });

  test('保持中の旧ハンドルがあれば、転送の案内をハンドルの欄に結び付けて示す', async () => {
    await renderProfileEditForm(myProfileOf({ previousHandle: 'old_handle' }));

    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(
        '以前のハンドル@old_handleは、次にハンドルを変更するまで新しいURLへ転送されます。他の利用者が同じハンドルを設定すると、転送は止まります。',
      );
  });

  test('旧ハンドルが無ければ、案内を示さない', async () => {
    await renderProfileEditForm(myProfileOf({ previousHandle: null }));

    await expect.element(handleInput()).not.toHaveAccessibleDescription();
    expect(profileForm().element().textContent).not.toContain('以前のハンドル');
  });

  test('ハンドルの入力欄の前に@を示し、@を含まない値を入力させる', async () => {
    await renderProfileEditForm();

    expect(
      profileForm().element().querySelector('[data-slot="handle-prefix"]')
        ?.textContent,
    ).toBe('@');
    await expect.element(handleInput()).toHaveValue('maker_ai');
  });
});
