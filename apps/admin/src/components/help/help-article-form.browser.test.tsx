import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { failure } from '../../../test/admin-accounts-fixtures.ts';
import {
  alert,
  ARTICLE,
  AUDITED_NOTICE,
  availabilityCalls,
  availabilityOf,
  button,
  CATEGORY_MOVE_NOTICE,
  categoryTrigger,
  editable,
  fillAndBlur,
  form,
  graphql,
  handleInput,
  NOT_FOUND_MESSAGE,
  option,
  OTHER,
  pinnedCheckbox,
  PREVIOUS_HANDLE_GUIDANCE,
  PRICING,
  reasonInput,
  renderCreateForm,
  renderEditForm,
  respond,
  statusRadio,
  subtitleInput,
  titleInput,
  USAGE,
  waitForEditor,
} from './help-article-form-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const optionNames = () =>
  page
    .getByRole('option')
    .elements()
    .map((element) => element.textContent);

beforeEach(() => {
  graphql.mockReset();
  respond();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('作成の初期値と欄', () => {
  test('空の欄・未選択のカテゴリ・ピン留めしない・下書きで始め、全欄が満たされるまで作成できない', async () => {
    await renderCreateForm();
    const body = await waitForEditor();

    await expect.element(form()).toHaveAccessibleName('ヘルプ記事の作成');
    await expect.element(titleInput()).toHaveValue('');
    await expect.element(subtitleInput()).toHaveValue('');
    await expect.element(handleInput()).toHaveValue('');
    await expect
      .element(categoryTrigger())
      .toHaveTextContent('選択してください');
    await expect.element(pinnedCheckbox()).not.toBeChecked();
    await expect
      .element(
        page.getByRole('radiogroup', { name: 'ステータス', exact: true }),
      )
      .toBeVisible();
    await expect.element(statusRadio('下書き')).toBeChecked();
    await expect.element(statusRadio('公開')).not.toBeChecked();
    expect(body.textContent).toBe('');
    await expect.element(page.getByText('0 / 100,000')).toBeVisible();
    await expect.element(button('作成する')).toBeDisabled();
    await expect.element(page.getByText(AUDITED_NOTICE)).toBeVisible();
    expect(
      form().element().querySelector('[data-slot="handle-prefix"]')
        ?.textContent,
    ).toBe('/help/');
  });

  test('カテゴリの選択肢をAPIが返した並び順のまま並べる', async () => {
    await renderCreateForm();

    await userEvent.click(categoryTrigger());

    await expect.element(option(PRICING.name)).toBeVisible();
    expect(optionNames()).toEqual([PRICING.name, USAGE.name, OTHER.name]);
  });

  test('欄の順はタイトル・サブタイトル・ハンドル・カテゴリ・ピン留め・ステータス・本文・理由・作成のボタン', async () => {
    await renderCreateForm();
    await waitForEditor();

    const all = Array.from(form().element().querySelectorAll('*'));
    const positions = [
      titleInput(),
      subtitleInput(),
      handleInput(),
      categoryTrigger(),
      pinnedCheckbox(),
      statusRadio('下書き'),
      editable(),
      reasonInput(),
      button('作成する'),
    ].map((locator) => all.indexOf(locator.element()));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('フォーカスアウトの検証', () => {
  test.each([
    ['タイトル', titleInput, ' 　', 'タイトルを入力してください。'],
    [
      'タイトル',
      titleInput,
      'あ'.repeat(101),
      'タイトルは100文字以内で入力してください。',
    ],
    ['サブタイトル', subtitleInput, '', 'サブタイトルを入力してください。'],
    ['ハンドル', handleInput, '', 'ハンドルを入力してください。'],
    [
      'ハンドル',
      handleInput,
      'a'.repeat(51),
      'ハンドルは50文字以内で入力してください。',
    ],
    [
      'ハンドル',
      handleInput,
      '-upvote',
      'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
    ],
  ])(
    '%sの欄の違反(%#)を、フォーカスを外した時にその欄に示し、使用可否を問い合わせない',
    async (_label, input, value, message) => {
      await renderCreateForm();

      await fillAndBlur(input(), value);

      await expect.element(input()).toHaveAccessibleDescription(message);
      await expect.element(input()).toHaveAttribute('aria-invalid', 'true');
      expect(availabilityCalls()).toHaveLength(0);
    },
  );

  test('カテゴリを選ばずにフォーカスを外すと、カテゴリを選ぶよう示す', async () => {
    await renderCreateForm();

    await userEvent.click(categoryTrigger());
    await userEvent.keyboard('{Escape}');
    await expect.element(categoryTrigger()).toHaveFocus();
    await userEvent.tab();

    await expect
      .element(categoryTrigger())
      .toHaveAccessibleDescription('カテゴリを選択してください。');
  });

  test('本文を空にしてフォーカスを外すと、本文を入力するよう示す', async () => {
    await renderEditForm();
    const body = await waitForEditor();

    await userEvent.click(body);
    await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}{Backspace}');
    await userEvent.tab();

    await expect
      .element(page.getByText('本文を入力してください。'))
      .toBeVisible();
    await expect.element(page.getByText('0 / 100,000')).toBeVisible();
    await expect.element(button('保存する')).toBeDisabled();
  });
});

describe('編集の初期値と欄', () => {
  test('読み込んだ記事の値・旧ハンドルの案内・カテゴリを変えると末尾に並ぶ旨を示す', async () => {
    await renderEditForm();
    const body = await waitForEditor();

    await expect.element(form()).toHaveAccessibleName('ヘルプ記事の編集');
    await expect.element(titleInput()).toHaveValue(ARTICLE.title);
    await expect.element(subtitleInput()).toHaveValue(ARTICLE.subtitle);
    await expect.element(handleInput()).toHaveValue(ARTICLE.handle);
    await expect
      .element(handleInput())
      .toHaveAccessibleDescription(PREVIOUS_HANDLE_GUIDANCE);
    await expect.element(categoryTrigger()).toHaveTextContent(USAGE.name);
    await expect
      .element(categoryTrigger())
      .toHaveAccessibleDescription(CATEGORY_MOVE_NOTICE);
    await expect.element(pinnedCheckbox()).toBeChecked();
    await expect.element(statusRadio('公開')).toBeChecked();
    expect(body.textContent).toContain('1人1票です。');
    await expect.element(button('保存する')).toBeEnabled();
  });

  test('本文はツールバーと、利用者側と同じ指定のプレビューを持つ', async () => {
    await renderEditForm({
      article: {
        ...ARTICLE,
        body: '## 数え方\n\n[外部のサイト](https://other.example/page)',
      },
    });
    await waitForEditor();

    await userEvent.click(page.getByRole('tab', { name: 'プレビュー' }));

    await expect
      .element(page.getByRole('heading', { level: 2, name: '数え方' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: '外部のサイト' }))
      .toHaveAttribute('rel', 'noopener');
  });

  test('ラベルを押すと本文の編集領域へフォーカスが移る', async () => {
    await renderEditForm();
    await waitForEditor();

    await userEvent.click(page.getByText('本文(必須)', { exact: true }));

    await expect.element(editable()).toHaveFocus();
  });

  test('100,000文字のカウンターを示し、超えると本文の上限の文言を示す', async () => {
    await renderEditForm({
      article: { ...ARTICLE, body: 'あ'.repeat(100_001) },
    });
    await waitForEditor();

    await expect.element(page.getByText('100,001 / 100,000')).toBeVisible();
    await userEvent.click(editable());
    await userEvent.tab();

    await expect
      .element(page.getByText('本文は100,000文字以内で入力してください。'))
      .toBeVisible();
    await expect.element(button('保存する')).toBeDisabled();
  });
});

describe('閲覧のみ', () => {
  test('全欄を無効にして値を示し、保存のボタン・理由の欄・監査ログの案内を出さない', async () => {
    await renderEditForm({ readOnly: true });
    await expect
      .element(editable())
      .toHaveAttribute('contenteditable', 'false');

    for (const input of [
      titleInput(),
      subtitleInput(),
      handleInput(),
      categoryTrigger(),
      pinnedCheckbox(),
      statusRadio('下書き'),
      statusRadio('公開'),
    ]) {
      await expect.element(input).toBeDisabled();
    }
    await expect
      .element(editable())
      .toHaveAttribute('contenteditable', 'false');
    await expect.element(titleInput()).toHaveValue(ARTICLE.title);
    expect(button('保存する').query()).toBeNull();
    expect(reasonInput().query()).toBeNull();
    expect(page.getByText(AUDITED_NOTICE).query()).toBeNull();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、欄のエラー・ハンドルの案内・保存の失敗の表示に自動検査の違反が無い',
    async (scheme) => {
      applyColorScheme(scheme);
      respond({
        availability: availabilityOf('AVAILABLE_RELEASES_PREVIOUS'),
        update: () =>
          failure({
            code: 'help_article_not_found',
            message: NOT_FOUND_MESSAGE,
            status: 404,
          }),
      });
      await renderEditForm();
      await waitForEditor();
      await fillAndBlur(handleInput(), 'old-handle');
      await expect.poll(() => availabilityCalls().length).toBe(1);
      await fillAndBlur(subtitleInput(), '');
      await expect
        .element(subtitleInput())
        .toHaveAttribute('aria-invalid', 'true');
      expect(await runAxe(document.body)).toStrictEqual([]);

      await fillAndBlur(subtitleInput(), '新しいサブタイトル');
      await userEvent.click(button('保存する'));
      await expect.element(alert()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('作成のフォームに自動検査の違反が無い', async () => {
    await renderCreateForm();
    await waitForEditor();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('閲覧のみのフォームに自動検査の違反が無い', async () => {
    await renderEditForm({ readOnly: true });
    await expect
      .element(editable())
      .toHaveAttribute('contenteditable', 'false');

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
