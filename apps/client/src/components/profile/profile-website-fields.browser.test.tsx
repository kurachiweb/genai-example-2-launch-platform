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
import {
  myProfileOf,
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

const URL_REQUIRED = '外部WebサイトのURLを入力してください。';
const URL_FORMAT =
  '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。';
const URL_TOO_LONG = '外部WebサイトURLは2,048文字以内で入力してください。';
const NAME_TOO_LONG = '外部Webサイトの名前は25文字以内で入力してください。';
const NAME_FORBIDDEN =
  '外部Webサイトの名前に使用できない文字が含まれています。';

const addButton = () =>
  page.getByRole('button', { name: '外部Webサイトを追加', exact: true });
const rowOf = (position: number) =>
  page.getByRole('group', { name: `外部Webサイト${String(position)}` });
const nameInputOf = (position: number) =>
  rowOf(position).getByRole('textbox', { name: '名前(任意)' });
const urlInputOf = (position: number) =>
  rowOf(position).getByRole('textbox', { name: 'URL' });
const removeButtonOf = (position: number) =>
  page.getByRole('button', {
    name: `外部Webサイト${String(position)}を削除`,
    exact: true,
  });
const rows = () => page.getByRole('group', { name: /^外部Webサイト\d+$/u });

const websitesOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `サイト${String(index + 1)}`,
    url: `https://maker${String(index + 1)}.example/`,
  }));

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('外部Webサイトの行', () => {
  test('登録済みの行を保存された順に、名前とURLの入力欄と削除のボタンで示す', async () => {
    await renderProfileEditForm(
      myProfileOf({
        websites: [
          { name: '個人サイト', url: 'https://maker.example/' },
          { name: null, url: 'https://blog.example/' },
        ],
      }),
    );

    await expect.element(nameInputOf(1)).toHaveValue('個人サイト');
    await expect.element(urlInputOf(1)).toHaveValue('https://maker.example/');
    await expect.element(nameInputOf(2)).toHaveValue('');
    await expect.element(urlInputOf(2)).toHaveValue('https://blog.example/');
    await expect.element(removeButtonOf(1)).toHaveTextContent('削除');
    await expect.element(removeButtonOf(2)).toHaveTextContent('削除');
  });

  test('行が無い時は追加のボタンだけを示す', async () => {
    await renderProfileEditForm();

    expect(rows().elements()).toHaveLength(0);
    await expect.element(addButton()).toBeEnabled();
  });

  test('追加すると空の行を末尾に足して名前の入力欄へフォーカスを移し、入力した順に保存の値へ渡す', async () => {
    const { onSave } = await renderProfileEditForm(
      myProfileOf({ websites: websitesOf(1) }),
    );

    await userEvent.click(addButton());

    await expect.element(nameInputOf(2)).toHaveFocus();
    await userEvent.fill(nameInputOf(2), '  ブログ ');
    await userEvent.fill(urlInputOf(2), ' https://blog.example/ ');
    await userEvent.click(saveButton());
    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].websites).toEqual([
      { name: 'サイト1', url: 'https://maker1.example/' },
      { name: 'ブログ', url: 'https://blog.example/' },
    ]);
  });

  test('名前が空の行は名前をnullで渡す', async () => {
    const { onSave } = await renderProfileEditForm();

    await userEvent.click(addButton());
    await userEvent.fill(urlInputOf(1), 'https://maker.example/');
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].websites).toEqual([
      { name: null, url: 'https://maker.example/' },
    ]);
  });

  test('削除すると、その行だけを取り除いて他の行の順を保ち、追加のボタンへフォーカスを移す', async () => {
    const { onSave } = await renderProfileEditForm(
      myProfileOf({ websites: websitesOf(3) }),
    );

    await userEvent.click(removeButtonOf(2));

    expect(rows().elements()).toHaveLength(2);
    await expect.element(nameInputOf(1)).toHaveValue('サイト1');
    await expect.element(nameInputOf(2)).toHaveValue('サイト3');
    await expect.element(addButton()).toHaveFocus();
    await userEvent.click(saveButton());
    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].websites.map(({ url }) => url)).toEqual([
      'https://maker1.example/',
      'https://maker3.example/',
    ]);
  });

  test('すべて削除すると空の一覧を保存の値に渡す', async () => {
    const { onSave } = await renderProfileEditForm(
      myProfileOf({ websites: websitesOf(1) }),
    );

    await userEvent.click(removeButtonOf(1));
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].websites).toEqual([]);
  });
});

describe('10件での追加', () => {
  test('9件なら追加でき、10件になると追加を無効にする', async () => {
    await renderProfileEditForm(myProfileOf({ websites: websitesOf(9) }));
    await expect.element(addButton()).toBeEnabled();

    await userEvent.click(addButton());

    expect(rows().elements()).toHaveLength(10);
    await expect.element(addButton()).toBeDisabled();
  });

  test('10件の登録済みなら最初から追加を無効にし、1件削除すると有効に戻る', async () => {
    await renderProfileEditForm(myProfileOf({ websites: websitesOf(10) }));
    await expect.element(addButton()).toBeDisabled();

    await userEvent.click(removeButtonOf(10));

    await expect.element(addButton()).toBeEnabled();
  });
});

describe('フォーカスアウトでの検証', () => {
  test.each([
    ['空のURL', urlInputOf, '', URL_REQUIRED],
    ['スキームの無いURL', urlInputOf, 'maker.example', URL_FORMAT],
    ['ftpのURL', urlInputOf, 'ftp://maker.example/', URL_FORMAT],
    ['javascriptのURL', urlInputOf, 'javascript:alert(1)', URL_FORMAT],
    [
      'スキームの直後に//の無いURL',
      urlInputOf,
      'https:maker.example',
      URL_FORMAT,
    ],
    [
      '2,049文字のURL',
      urlInputOf,
      `https://maker.example/${'a'.repeat(2027)}`,
      URL_TOO_LONG,
    ],
    ['26文字の名前', nameInputOf, 'あ'.repeat(26), NAME_TOO_LONG],
    ['使用できない文字を含む名前', nameInputOf, 'サイト\u0001', NAME_FORBIDDEN],
  ])(
    '%sなら、フォーカスを外すとその行の欄に文言を示す',
    async (_name, input, value, message) => {
      await renderProfileEditForm(myProfileOf({ websites: websitesOf(2) }));

      await userEvent.fill(input(2), value);
      await expect.element(input(2)).not.toHaveAttribute('aria-invalid');
      await userEvent.tab();

      await expect.element(input(2)).toHaveAccessibleDescription(message);
      await expect.element(input(2)).toHaveAttribute('aria-invalid', 'true');
      await expect.element(input(1)).not.toHaveAttribute('aria-invalid');
      await expect.element(saveButton()).toBeDisabled();
    },
  );

  test('空の行を追加して何も入力せずに離れると、URLの未入力の文言を示す', async () => {
    await renderProfileEditForm();

    await userEvent.click(addButton());
    await userEvent.click(nameInputOf(1));
    await userEvent.tab();
    await userEvent.tab();

    await expect
      .element(urlInputOf(1))
      .toHaveAccessibleDescription(URL_REQUIRED);
  });

  test('直すと文言が消える', async () => {
    await renderProfileEditForm(myProfileOf({ websites: websitesOf(1) }));
    await userEvent.fill(urlInputOf(1), 'maker.example');
    await userEvent.tab();
    await expect.element(urlInputOf(1)).toHaveAccessibleDescription(URL_FORMAT);

    await userEvent.fill(urlInputOf(1), 'https://maker.example/');

    await expect.element(urlInputOf(1)).not.toHaveAttribute('aria-invalid');
    await expect.element(saveButton()).toBeEnabled();
  });

  test('違反のある行を削除すると、保存を送れる状態に戻る', async () => {
    await renderProfileEditForm(myProfileOf({ websites: websitesOf(2) }));
    await userEvent.fill(urlInputOf(2), 'maker.example');
    await userEvent.tab();
    await expect.element(saveButton()).toBeDisabled();

    await userEvent.click(removeButtonOf(2));

    await expect.element(saveButton()).toBeEnabled();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、行と文言を出した状態の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderProfileEditForm(myProfileOf({ websites: websitesOf(2) }));
      await userEvent.fill(urlInputOf(2), 'maker.example');
      await userEvent.tab();
      await expect
        .element(urlInputOf(2))
        .toHaveAttribute('aria-invalid', 'true');

      expect(await runAxe(profileForm().element())).toEqual([]);
    },
  );

  test('10件で追加を無効にした状態の違反が0件である', async () => {
    await renderProfileEditForm(myProfileOf({ websites: websitesOf(10) }));
    await expect.element(addButton()).toBeDisabled();

    expect(await runAxe(document.body)).toEqual([]);
  });
});
