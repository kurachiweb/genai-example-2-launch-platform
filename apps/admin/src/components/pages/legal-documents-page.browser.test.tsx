import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  LEGAL_DOCUMENT_SUMMARIES,
  type LegalDocumentsHandler,
  renderLegalDocumentsPage,
  respondLegalDocumentsGraphQL,
} from '../../../test/legal-documents-fixtures.ts';
import { loadAdminLegalDocuments } from '../../graphql/admin-legal-documents.ts';
import { Route as LegalDocumentsRoute } from '../../routes/_authenticated/legal-documents/index.tsx';
import { LegalDocumentsPage } from './legal-documents-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: '法務文書の一覧' });
const listHeading = () =>
  main().getByRole('heading', { level: 2, name: '法務文書の一覧' });
const navigation = () => page.getByRole('navigation', { name: '管理メニュー' });

const renderWith = async (legalDocuments?: LegalDocumentsHandler) => {
  respondLegalDocumentsGraphQL(executeGraphQL, {
    role: 'VIEWER',
    ...(legalDocuments === undefined ? {} : { legalDocuments }),
  });
  return renderLegalDocumentsPage('VIEWER');
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

test('経路の設定は画面のテストが写したものと同じ読み込みの関数とページの部品を使う', () => {
  expect(LegalDocumentsRoute.options.loader).toBe(loadAdminLegalDocuments);
  expect(LegalDocumentsRoute.options.component).toBe(LegalDocumentsPage);
});

describe('法務文書の画面', () => {
  test('見出しと3文書の一覧を表示し、メニューの「法務文書」を現在のページとして示す', async () => {
    await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
    await renderWith();

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('法務文書');
    await expect.element(table()).toBeVisible();
    expect(table().getByRole('row').elements()).toHaveLength(
      LEGAL_DOCUMENT_SUMMARIES.adminLegalDocuments.length + 1,
    );
    await expect
      .element(navigation().getByRole('link', { name: '法務文書' }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(navigation().getByRole('link', { name: '法務文書' }))
      .toHaveAttribute('href', '/legal-documents');
  });

  test('再試行の取得の間は、失敗の表示を消して一覧の場所に読み込み中を示し、取得できたら一覧に替える', async () => {
    let retried = false;
    let respond: (value: unknown) => void = () => undefined;
    await renderWith(() => {
      return !retried
        ? failure({
            code: 'internal_error',
            message: '処理中に問題が発生しました。',
            status: 500,
          })
        : new Promise((resolve) => {
            respond = resolve;
          });
    });
    await expect.element(main().getByRole('alert')).toBeVisible();
    retried = true;

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(main().getByRole('alert').query()).toBeNull();
    expect(table().query()).toBeNull();
    await expect.element(listHeading()).toBeVisible();

    respond(await success(LEGAL_DOCUMENT_SUMMARIES));

    await expect.element(table()).toBeVisible();
    expect(main().getByRole('status').query()).toBeNull();
  });

  test('取得の失敗は一覧の場所にAPIの文言と再試行の操作で示し、問い合わせの導線を出さず、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith(() =>
      available
        ? success(LEGAL_DOCUMENT_SUMMARIES)
        : failure({
            code: 'internal_error',
            message: '処理中に問題が発生しました。',
            status: 500,
          }),
    );

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    expect(
      main().getByRole('link', { name: 'お問い合わせ' }).query(),
    ).toBeNull();
    expect(main().element().textContent).not.toContain('お問い合わせ');
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('GraphQLの失敗でない例外は、例外の文言を出さずに問い合わせを促す文を含まない管理者側の文言で示す', async () => {
    await renderWith(() => Promise.reject(new TypeError('secret detail')));

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(
        'ページを表示できませんでした。時間をおいて再度お試しください。',
      );
    expect(main().element().textContent).not.toContain('secret detail');
    expect(main().element().textContent).not.toContain('お問い合わせ');
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧の画面がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await expect.element(table()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith(() =>
        failure({
          code: 'internal_error',
          message: '処理中に問題が発生しました。',
          status: 500,
        }),
      );
      await expect.element(main().getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
