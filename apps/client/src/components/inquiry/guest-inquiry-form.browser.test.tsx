import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { ClientSubmitGuestInquiryDocument } from '../../graphql/generated/graphql.ts';
import { GuestInquiryForm } from './guest-inquiry-form.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const BUG_CATEGORY_ID = '01JC0CATEG0RY0000000000001';

const CATEGORIES = Object.freeze([
  { id: BUG_CATEGORY_ID, name: '不具合の報告' },
  { id: '01JC0000000000000000000000', name: 'その他' },
]);

const EMAIL = 'maker@launch.example';

const BODY = '1行目\n2行目';

const RATE_LIMITED_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';

const form = () => page.getByRole('form', { name: 'お問い合わせフォーム' });
const categorySelect = () =>
  page.getByRole('combobox', { name: 'カテゴリ(必須)' });
const nicknameInput = () =>
  page.getByRole('textbox', { name: 'ニックネーム(必須)' });
const emailInput = () =>
  page.getByRole('textbox', { name: '連絡先メールアドレス(必須)' });
const bodyInput = () => page.getByRole('textbox', { name: 'メッセージ(必須)' });
const submitButton = () => page.getByRole('button', { name: '送信する' });
const alert = () => form().getByRole('alert');
const completion = () =>
  page.getByRole('heading', { name: 'お問い合わせを受け付けました。' });

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

// アプリでは文書の外枠が日時の部品へ表示設定を渡すため、同じ提供元で包む
const renderForm = () =>
  renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <GuestInquiryForm categories={CATEGORIES} />
    </DisplayPreferencesProvider>,
    { path: '/contact' },
  );

async function fillValidInput(): Promise<void> {
  await userEvent.selectOptions(categorySelect(), '不具合の報告');
  await userEvent.type(nicknameInput(), ' ピッチの作り手　');
  await userEvent.type(emailInput(), EMAIL);
  await userEvent.fill(bodyInput(), BODY);
}

async function passBotCheckAndSubmit(): Promise<void> {
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
  await userEvent.click(submitButton());
}

const rejectWith = (error: GraphQLClientError) =>
  Promise.resolve({ ok: false, error });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('GuestInquiryForm', () => {
  test('フォーカスを外した時に、欄ごとに文言規則のエラーを入力欄に関連付けて示す', async () => {
    await renderForm();

    categorySelect().element().focus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.type(emailInput(), 'maker@');
    await userEvent.click(bodyInput());
    await userEvent.tab();

    await expect
      .element(categorySelect())
      .toHaveAccessibleDescription('カテゴリを選択してください。');
    await expect
      .element(nicknameInput())
      .toHaveAccessibleDescription(
        expect.stringContaining('ニックネームを入力してください。') as string,
      );
    await expect
      .element(emailInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'メールアドレスの形式が正しくありません。',
        ) as string,
      );
    await expect
      .element(bodyInput())
      .toHaveAccessibleDescription(
        expect.stringContaining('メッセージを入力してください。') as string,
      );
    await expect.element(bodyInput()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(submitButton()).toBeDisabled();
  });

  test('bot判定は未ログインの問い合わせの操作名の非表示のウィジェットで行い、判定の枠を画面に出さない', async () => {
    await renderForm();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    const { width, height } = page
      .getByTestId('fake-turnstile')
      .element()
      .getBoundingClientRect();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'inquiry_guest',
      size: 'invisible',
    });
    expect({ width, height }).toEqual({ width: 0, height: 0 });
  });

  test('送信すると、ニックネームと連絡先の前後の空白を除き本文はそのままの入力とbot判定のトークンで送り、フォームを送信完了の表示に置き換えてフォーカスを移す', async () => {
    executeGraphQL.mockResolvedValue({
      ok: true,
      data: { submitGuestInquiry: true },
    });
    await renderForm();

    await fillValidInput();
    await passBotCheckAndSubmit();

    await expect.element(completion()).toHaveFocus();
    await expect
      .element(
        page.getByText(
          '回答は入力したメールアドレスへお送りする場合があります。',
        ),
      )
      .toBeVisible();
    expect(form().query()).toBeNull();
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientSubmitGuestInquiryDocument,
      {
        input: {
          categoryId: BUG_CATEGORY_ID,
          nickname: 'ピッチの作り手',
          email: EMAIL,
          body: BODY,
        },
      },
      { turnstileToken: 'turnstile-token-1' },
    );
  });

  test('サーバーが返した欄ごとの詳細を欄のエラーにして、最初の欄へフォーカスを移す', async () => {
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'input.categoryId',
              code: 'not-found',
              message: 'カテゴリを選択してください。',
            },
            {
              field: 'input.nickname',
              code: 'forbidden-character',
              message: 'ニックネームに使用できない文字が含まれています。',
            },
            {
              field: 'input.email',
              code: 'invalid',
              message: 'メールアドレスの形式が正しくありません。',
            },
            {
              field: 'input.body',
              code: 'too-long',
              message: 'メッセージは5,000文字以内で入力してください。',
            },
          ],
        }),
      ),
    );
    await renderForm();

    await fillValidInput();
    await passBotCheckAndSubmit();

    await expect.element(categorySelect()).toHaveFocus();
    await expect
      .element(categorySelect())
      .toHaveAccessibleDescription('カテゴリを選択してください。');
    await expect
      .element(nicknameInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'ニックネームに使用できない文字が含まれています。',
        ) as string,
      );
    await expect
      .element(emailInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'メールアドレスの形式が正しくありません。',
        ) as string,
      );
    await expect
      .element(bodyInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'メッセージは5,000文字以内で入力してください。',
        ) as string,
      );
    expect(alert().elements()).toHaveLength(0);
  });

  test('送信の回数の上限を超えると、再度送信できる日時を添えて示し、フォームを残す', async () => {
    const retryAfterSeconds = 1800;
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'rate_limit_exceeded',
          message: RATE_LIMITED_MESSAGE,
          status: 429,
          retryAfterSeconds,
        }),
      ),
    );
    await renderForm();

    await fillValidInput();
    const sentAt = Date.now();
    await passBotCheckAndSubmit();

    await expect
      .element(alert())
      .toHaveTextContent(
        new RegExp(`^${RATE_LIMITED_MESSAGE}.+以降に再度送信できます。$`, 'u'),
      );
    const retryAt = Date.parse(
      alert().element().querySelector('time')?.dateTime ?? '',
    );
    expect(retryAt).toBeGreaterThanOrEqual(sentAt + retryAfterSeconds * 1000);
    expect(retryAt).toBeLessThan(sentAt + (retryAfterSeconds + 60) * 1000);
    await expect.element(bodyInput()).toHaveValue(BODY);
  });

  test('欄に対応しない失敗は、フォームの文言で示す', async () => {
    const message =
      'ログイン中のため、このフォームは使えません。ページを再読み込みしてください。';
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'member_inquiry_required',
          message,
          status: 403,
        }),
      ),
    );
    await renderForm();

    await fillValidInput();
    await passBotCheckAndSubmit();

    await expect.element(alert()).toHaveTextContent(message);
    expect(completion().query()).toBeNull();
  });

  test('想定外の失敗は、例外の文言を出さず問い合わせを促す文言で示す', async () => {
    executeGraphQL.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderForm();

    await fillValidInput();
    await passBotCheckAndSubmit();

    await expect
      .element(alert())
      .toHaveTextContent(
        'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
      );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('入力前・エラーの表示中・送信完了の表示で、アクセシビリティの検査の違反が0件', async () => {
      executeGraphQL.mockResolvedValue({
        ok: true,
        data: { submitGuestInquiry: true },
      });
      await renderForm();
      const initial = await runAxe(form().element());

      await userEvent.click(nicknameInput());
      await userEvent.tab();
      await expect
        .element(nicknameInput())
        .toHaveAttribute('aria-invalid', 'true');
      const invalid = await runAxe(form().element());

      await fillValidInput();
      await passBotCheckAndSubmit();
      await expect.element(completion()).toBeVisible();

      expect(initial).toStrictEqual([]);
      expect(invalid).toStrictEqual([]);
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
