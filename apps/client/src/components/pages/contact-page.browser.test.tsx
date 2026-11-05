import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_NICKNAME,
} from '../../../test/viewer-fixtures.ts';
import type { InquiryContactFormView } from '../../graphql/inquiry-contact.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { ContactPage } from './contact-page.tsx';

// 同型の取得の関数はサーバーの分岐でブラウザから読めないサーバー専用のパッケージを読み込むため、描画だけを確かめるこのテストでは偽物にする
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const CATEGORIES = Object.freeze([
  { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
  { id: '01JC0CATEG0RY0000000000002', name: 'アカウント' },
  { id: '01JC0000000000000000000000', name: 'その他' },
]);

const GUEST_FORM: InquiryContactFormView = {
  categories: CATEGORIES,
  composer: null,
};

const MEMBER_FORM: InquiryContactFormView = {
  categories: CATEGORIES,
  composer: { nickname: VIEWER_NICKNAME, avatar: null },
};

type ViewerState = 'guest' | 'suspended' | 'active';

const viewerOf = (state: ViewerState): ClientViewer | null => {
  if (state === 'guest') {
    return null;
  }
  const viewer = signedInViewerQuery({
    status: state === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
  }).viewer;
  if (viewer === null) {
    throw new Error('ログイン中の利用者を作れませんでした。');
  }
  return viewer;
};

const formOf = (state: ViewerState): InquiryContactFormView =>
  state === 'active' ? MEMBER_FORM : GUEST_FORM;

const renderPage = (state: ViewerState) =>
  renderInRouter(
    <ContactPage viewer={viewerOf(state)} form={formOf(state)} />,
    { path: '/contact' },
  );

const pageTitle = () => page.getByRole('heading', { level: 1 });
const form = () => page.getByRole('form', { name: 'お問い合わせフォーム' });
const categorySelect = () =>
  page.getByRole('combobox', { name: 'カテゴリ(必須)' });
const nicknameInput = () =>
  page.getByRole('textbox', { name: 'ニックネーム(必須)' });
const emailInput = () =>
  page.getByRole('textbox', { name: '連絡先メールアドレス(必須)' });
const bodyInput = () => page.getByRole('textbox', { name: 'メッセージ(必須)' });
const attachmentButton = () =>
  page.getByRole('button', { name: '添付ファイル ファイルを選択' });
const suspendedNotice = () =>
  page.getByRole('note', { name: '停止中のアカウント' });
const composer = () => page.getByRole('group', { name: '送信者' });

beforeEach(() => {
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('ContactPage', () => {
  test('カテゴリを追加の順(標準カテゴリが末尾)の選択肢として示す', async () => {
    await renderPage('guest');

    await expect.element(pageTitle()).toHaveTextContent('お問い合わせ');
    const options = Array.from(
      categorySelect().element().querySelectorAll('option'),
    ).map((option) => option.textContent);
    expect(options).toEqual([
      '選択してください',
      '不具合の報告',
      'アカウント',
      'その他',
    ]);
  });

  test('未ログインでは、ニックネームと連絡先メールアドレスを含む必須の欄を示し、添付と送信者を示さない', async () => {
    await renderPage('guest');

    await expect.element(nicknameInput()).toHaveAttribute('aria-required');
    await expect.element(emailInput()).toHaveAttribute('aria-required');
    await expect.element(bodyInput()).toHaveAttribute('aria-required');
    await expect.element(categorySelect()).toHaveAttribute('aria-required');
    expect(attachmentButton().query()).toBeNull();
    expect(composer().query()).toBeNull();
    expect(suspendedNotice().query()).toBeNull();
  });

  test('停止中の利用者には、未ログインと同じ欄と、回答が連絡先メールアドレスへ届く旨を示す', async () => {
    await renderPage('suspended');

    await expect
      .element(suspendedNotice())
      .toHaveTextContent(
        'このアカウントは停止中のため、ログインしていない場合と同じフォームでお問い合わせを受け付けます。この問い合わせへの回答はサービス上では行わず、入力した連絡先メールアドレスへお送りします。',
      );
    await expect.element(nicknameInput()).toBeVisible();
    await expect.element(emailInput()).toBeVisible();
    expect(attachmentButton().query()).toBeNull();
    expect(composer().query()).toBeNull();
  });

  test('停止していないログイン中の利用者には、送信者のニックネームと既定のアイコン・添付の欄を示し、ニックネームと連絡先の欄を示さない', async () => {
    await renderPage('active');

    await expect.element(composer()).toHaveTextContent(VIEWER_NICKNAME);
    expect(
      composer().element().querySelector('[data-slot="media-placeholder"]'),
    ).not.toBeNull();
    await expect.element(attachmentButton()).toBeVisible();
    await expect.element(bodyInput()).toBeVisible();
    expect(nicknameInput().query()).toBeNull();
    expect(emailInput().query()).toBeNull();
    expect(suspendedNotice().query()).toBeNull();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each<ViewerState>(['guest', 'suspended', 'active'])(
      '利用者の状態が%sのページで、アクセシビリティの検査の違反が0件',
      async (state) => {
        await renderPage(state);
        await expect.element(form()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
