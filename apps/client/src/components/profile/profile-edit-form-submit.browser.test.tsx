import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
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
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
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

const bioInput = () => page.getByRole('textbox', { name: '自己紹介' });
const toolbar = () => page.getByRole('toolbar', { name: '書式' });

async function waitForEditor(): Promise<void> {
  await expect.element(bioInput()).toBeInTheDocument();
  await expect
    .element(toolbar().getByRole('button', { name: '太字', exact: true }))
    .not.toHaveAttribute('disabled');
}

async function replaceBio(text: string): Promise<void> {
  await waitForEditor();
  await userEvent.click(bioInput());
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
  await userEvent.keyboard(text);
}

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(() =>
    Promise.resolve({ ok: true, data: { handleAvailability: 'AVAILABLE' } }),
  );
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('自己紹介のマークダウンの入力欄', () => {
  test('書式のツールバー・書くとプレビューの切り替え・文字数のカウンターを備える', async () => {
    await renderProfileEditForm(myProfileOf({ bio: '自己紹介' }));
    await waitForEditor();

    await expect
      .element(toolbar().getByRole('button', { name: '太字', exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole('tab', { name: '書く' })).toBeVisible();
    await expect
      .element(page.getByRole('tab', { name: 'プレビュー' }))
      .toBeVisible();
    await expect.element(page.getByText('4 / 5,000')).toBeVisible();
  });

  test('プレビューを、公開プロフィールと同じrelの指定で描く', async () => {
    await renderProfileEditForm(
      myProfileOf({
        bio: '**太字**と[外部のサイト](https://other.example/page)',
      }),
    );
    await waitForEditor();

    await userEvent.click(page.getByRole('tab', { name: 'プレビュー' }));

    await expect
      .element(
        page
          .getByRole('tabpanel', { name: 'プレビュー' })
          .getByText('太字', { exact: true }),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: '外部のサイト' }))
      .toHaveAttribute('rel', 'noopener ugc');
  });

  test('ラベルを押すと編集領域へフォーカスが移る', async () => {
    await renderProfileEditForm();
    await waitForEditor();

    await userEvent.click(page.getByText('自己紹介', { exact: true }));

    await expect.element(bioInput()).toHaveFocus();
  });

  test('入力した自己紹介を保存の値に渡し、空にすると未設定として渡す', async () => {
    const { onSave } = await renderProfileEditForm(
      myProfileOf({ bio: '書き換える前' }),
    );

    await replaceBio('書き換えた自己紹介');
    await userEvent.click(saveButton());
    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].bio).toBe('書き換えた自己紹介');

    await replaceBio('{Backspace}');
    await userEvent.click(saveButton());
    await expect.poll(() => onSave.mock.calls.length).toBe(2);
    expect(onSave.mock.calls[1]?.[0].bio).toBeNull();
  });

  test.each(COLOR_SCHEMES)(
    '%sで、プレビューを開いてもアクセシビリティの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderProfileEditForm(myProfileOf({ bio: '## 見出し\n\n本文' }));
      await waitForEditor();
      await userEvent.click(page.getByRole('tab', { name: 'プレビュー' }));
      await expect
        .element(page.getByRole('heading', { name: '見出し' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toEqual([]);
    },
  );
});

describe('保存の送信', () => {
  test('検証を通った値を、前後の空白を除き未入力の任意項目をnullにして渡す', async () => {
    const { onSave } = await renderProfileEditForm(
      myProfileOf({ avatar: null }),
    );

    await userEvent.fill(nicknameInput(), '  新しい名前 ');
    await userEvent.fill(handleInput(), 'New-Handle');
    await userEvent.fill(headlineInput(), '');
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      nickname: '新しい名前',
      handle: 'New-Handle',
      headline: null,
      bio: null,
      avatarFileId: null,
      websites: [],
    });
  });

  test('値に読み込んだ時点のハンドルを含めず、bot対策のトークンの取り出し口を渡す', async () => {
    const { onSave } = await renderProfileEditForm();

    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    const [values, turnstile] = onSave.mock.calls[0] ?? [];
    expect(values).not.toHaveProperty('expectedHandle');
    expect(typeof turnstile?.consume).toBe('function');
    expect(typeof turnstile?.waitForToken).toBe('function');
  });

  test('bot対策のウィジェットを非表示でプロフィールの操作名で置く', async () => {
    await renderProfileEditForm();

    await expect
      .poll(() => lastTurnstileProps().options?.action)
      .toBe('profile_update');
    expect(lastTurnstileProps().options?.size).toBe('invisible');
    expect(
      profileForm()
        .element()
        .querySelector('[data-slot="turnstile-widget"]')
        ?.parentElement?.getAttribute('data-slot'),
    ).not.toBe('form-field');
  });

  test('検証に違反する欄が残る間は保存を送らない', async () => {
    const { onSave } = await renderProfileEditForm();

    await userEvent.fill(nicknameInput(), '');
    await userEvent.tab();
    await expect.element(saveButton()).toBeDisabled();
    await userEvent.keyboard('{Enter}');

    expect(onSave).not.toHaveBeenCalled();
  });

  test('送信の失敗を、欄に対応しないものはフォームの近くのalertに固定の文言で示す', async () => {
    const onSave = vi.fn(() => Promise.reject(new TypeError('内部の詳細')));
    await renderProfileEditForm(myProfileOf(), onSave);

    await userEvent.click(saveButton());

    await expect
      .element(profileForm().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
    expect(profileForm().element().textContent).not.toContain('内部の詳細');
  });

  test('サーバーが返した文言(競合など)をそのまま示し、次の送信で消す', async () => {
    const conflict = new GraphQLClientError({
      code: 'profile_update_conflict',
      message:
        'プロフィールが別の画面で変更されました。最新の内容を読み込んでから保存してください。',
      status: 409,
    });
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined);
    await renderProfileEditForm(myProfileOf(), onSave);

    await userEvent.click(saveButton());
    await expect
      .element(profileForm().getByRole('alert'))
      .toHaveTextContent(conflict.message);
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(2);
    expect(profileForm().getByRole('alert').query()).toBeNull();
  });

  test('サーバーの欄の詳細(使用中)をハンドルの欄に示し、保存を無効にする', async () => {
    const taken =
      'このハンドルは既に使われています。別の文字列を入力してください。';
    const onSave = vi.fn(() =>
      Promise.reject(
        new GraphQLClientError({
          code: 'handle_unavailable',
          message: taken,
          status: 409,
          details: [
            { field: 'input.handle', code: 'unavailable', message: taken },
          ],
        }),
      ),
    );
    await renderProfileEditForm(myProfileOf(), onSave);

    await userEvent.click(saveButton());

    await expect.element(handleInput()).toHaveAccessibleDescription(taken);
    await expect.element(handleInput()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(saveButton()).toBeDisabled();
    expect(profileForm().getByRole('alert').query()).toBeNull();
  });
});

describe('停止中のアカウント', () => {
  const SUSPENDED_NOTICE =
    'このアカウントは停止されているため、プロフィールは変更できません。';

  test('全欄を無効にし、保存の送信ボタンを無効にして、変更できない旨を示す', async () => {
    await renderProfileEditForm(
      myProfileOf({
        suspended: true,
        websites: [{ name: '個人サイト', url: 'https://maker.example/' }],
      }),
    );
    await expect.element(bioInput()).toHaveAttribute('aria-disabled', 'true');

    await expect.element(nicknameInput()).toBeDisabled();
    await expect.element(handleInput()).toBeDisabled();
    await expect.element(headlineInput()).toBeDisabled();
    await expect.element(bioInput()).toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(page.getByRole('button', { name: '画像を選択', exact: false }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('textbox', { name: '名前(任意)' }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('textbox', { name: 'URL' }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: '外部Webサイトを追加' }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: '外部Webサイト1を削除' }))
      .toBeDisabled();
    await expect.element(saveButton()).toBeDisabled();
    await expect
      .element(page.getByRole('note', { name: '停止中のアカウント' }))
      .toHaveTextContent(SUSPENDED_NOTICE);
  });

  test('停止中でなければ案内を出さない', async () => {
    await renderProfileEditForm();

    expect(page.getByRole('note').query()).toBeNull();
    expect(profileForm().element().textContent).not.toContain(SUSPENDED_NOTICE);
  });

  test.each(COLOR_SCHEMES)(
    '%sでアクセシビリティの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderProfileEditForm(myProfileOf({ suspended: true }));
      await expect.element(bioInput()).toHaveAttribute('aria-disabled', 'true');

      expect(await runAxe(document.body)).toEqual([]);
    },
  );
});
