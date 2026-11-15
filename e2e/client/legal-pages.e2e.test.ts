import { expect, type Locator, type Page, test } from '@playwright/test';

import { INTERNAL_ERROR_RESPONSE } from '../../apps/backend-lib/core/errors/error-envelope.ts';
import {
  FOOTER_POLICY_NAVIGATION_LABEL,
  HOME_HREF,
} from '../../apps/client/src/components/layout/site-links.ts';
import {
  LAST_REVISED_LABEL,
  LEGAL_DOCUMENT_PREPARING_MESSAGE,
} from '../../apps/client/src/components/legal/legal-messages.ts';
import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
} from '../../apps/common-lib/legal/legal-documents.ts';
import { SWITCH_TO_DARK_LABEL } from '../../apps/frontend-lib/utilities/messages/app-shell-messages.ts';
import {
  CONTACT_LABEL,
  RETRY_LABEL,
  UNEXPECTED_ERROR_MESSAGE,
} from '../../apps/frontend-lib/utilities/messages/state-messages.ts';
import { exhaustApiIpRateLimit } from '../support/api-rate-limit.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import {
  recordRelayGraphQLRequests,
  RELAY_GRAPHQL_PATH,
} from '../support/system-status-page.ts';

const TERMS_PATH = LEGAL_DOCUMENT_PATHS.terms;
const TERMS_LABEL = LEGAL_DOCUMENT_LABELS.terms;
const CONTACT_PATH = '/contact';

const isRelayGraphQLURL = (url: URL): boolean =>
  url.pathname === RELAY_GRAPHQL_PATH;

const MARKDOWN_CONTENT_SELECTOR = '[data-slot="markdown-content"]';

// 同じ文書の中で遷移したことを、遷移の前にwindowへ置いた値が残っていることで確かめる
const SAME_DOCUMENT_MARKER = 'legalPagesSameDocumentMarker';

const footerPolicyNavigation = (page: Page): Locator =>
  page
    .getByRole('contentinfo')
    .getByRole('navigation', { name: FOOTER_POLICY_NAVIGATION_LABEL });

const documentHeading = (page: Page, label: string): Locator =>
  page
    .getByRole('main')
    .getByRole('heading', { level: 1, name: label, exact: true });

async function expectFooterLegalLinks(page: Page): Promise<void> {
  for (const kind of LEGAL_DOCUMENT_KINDS) {
    await expect(
      footerPolicyNavigation(page).getByRole('link', {
        name: LEGAL_DOCUMENT_LABELS[kind],
        exact: true,
      }),
    ).toHaveAttribute('href', LEGAL_DOCUMENT_PATHS[kind]);
  }
}

// 見出しは読み込み中・失敗の表示でも文書の名前になるため、取得に成功した時だけ出る公開済み(最終改訂日)か準備中の表示で到達を確かめる
async function expectLoadedDocument(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(
    main
      .getByText(LEGAL_DOCUMENT_PREPARING_MESSAGE)
      .or(main.getByRole('term').filter({ hasText: LAST_REVISED_LABEL })),
  ).toBeVisible();
  await expect(main.getByRole('alert')).toHaveCount(0);
}

// 共通レイアウトの本文の中に、再試行と問い合わせの導線を持つ想定外のエラーの表示があることを確かめる
async function expectUnexpectedErrorInLayout(
  page: Page,
  label: string,
): Promise<void> {
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  const main = page.getByRole('main');
  await expect(documentHeading(page, label)).toBeVisible();
  await expect(main.getByRole('alert')).toBeVisible();
  await expect(
    main.getByRole('button', { name: RETRY_LABEL, exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: CONTACT_LABEL, exact: true }),
  ).toHaveAttribute('href', CONTACT_PATH);
}

// ハイドレーションの完了の合図が無く、その前に押したボタンは何もしないため、配色の切替のボタンが効いた(html要素にdarkクラスが付いた)ことを完了とみなす。付いた後は押さないため、2回切り替えて元に戻すことはない
async function waitForHydration(page: Page): Promise<void> {
  const html = page.locator('html');
  const toggle = page
    .getByRole('banner')
    .getByRole('button', { name: SWITCH_TO_DARK_LABEL });
  await expect(async () => {
    if (
      !(await html.evaluate((element) => element.classList.contains('dark')))
    ) {
      await toggle.click();
    }
    await expect(html).toHaveClass(/\bdark\b/u, {
      timeout: REACTION_TIMEOUT_MS,
    });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

interface DocumentContent {
  readonly heading: string | null;
  readonly body: string | null;
}

// サーバーが返したHTML(htmlを渡した時)か、ブラウザの今の文書の、本文の見出しとマークダウンの本文を読む
const readDocumentContent = (
  page: Page,
  html?: string,
): Promise<DocumentContent> =>
  page.evaluate(
    ({ source, bodySelector }) => {
      const root =
        source === undefined
          ? document
          : new DOMParser().parseFromString(source, 'text/html');
      const main = root.querySelector('main');
      return {
        heading: main?.querySelector('h1')?.textContent ?? null,
        body: main?.querySelector(bodySelector)?.innerHTML ?? null,
      };
    },
    { source: html, bodySelector: MARKDOWN_CONTENT_SELECTOR },
  );

test.describe('共通フッターから法務文書の公開ページへの到達', () => {
  for (const kind of LEGAL_DOCUMENT_KINDS) {
    const label = LEGAL_DOCUMENT_LABELS[kind];
    const path = LEGAL_DOCUMENT_PATHS[kind];

    test(`トップページのフッターの${label}のリンクから${path}へ移動でき、見出しが${label}で、最終改訂日か準備中の表示が出て、移動先にも共通フッターの3文書へのリンクがある`, async ({
      page,
    }) => {
      await page.goto(HOME_HREF);

      await footerPolicyNavigation(page)
        .getByRole('link', { name: label, exact: true })
        .click();

      await expect(page).toHaveURL((url) => url.pathname === path);
      await expect(documentHeading(page, label)).toBeVisible();
      await expectLoadedDocument(page);
      await expectFooterLegalLinks(page);
    });
  }
});

test.describe('公開ページの取得の流れ', () => {
  test('最初の表示ではサーバー側で取得した見出しと本文を返し、ハイドレーションの後も中継へ取得し直さず、表示がサーバー側の描画のままである', async ({
    page,
  }) => {
    const relayRequests = recordRelayGraphQLRequests(page);

    const response = await page.goto(TERMS_PATH);
    const serverContent = await readDocumentContent(
      page,
      (await response?.text()) ?? '',
    );
    await waitForHydration(page);

    expect(response?.status()).toBe(200);
    expect(serverContent.heading).toBe(TERMS_LABEL);
    await expect(documentHeading(page, TERMS_LABEL)).toBeVisible();
    await expectLoadedDocument(page);
    expect(await readDocumentContent(page)).toStrictEqual(serverContent);
    expect(
      relayRequests().map((request) => `${request.method()} ${request.url()}`),
    ).toStrictEqual([]);
  });

  test.describe('スクリプトを実行しないブラウザ', () => {
    test.use({ javaScriptEnabled: false });

    test('サーバーが描画したHTMLだけで、文書の名前の見出しと、本文か準備中の表示を出す', async ({
      page,
    }) => {
      await page.goto(TERMS_PATH);

      await expect(documentHeading(page, TERMS_LABEL)).toBeVisible();
      await expectLoadedDocument(page);
      const content = await readDocumentContent(page);
      const preparing = page
        .getByRole('main')
        .getByText(LEGAL_DOCUMENT_PREPARING_MESSAGE);
      expect(
        content.body !== null || (await preparing.isVisible()),
        '本文か準備中の表示',
      ).toBe(true);
    });
  });

  test('共通フッターのリンクでブラウザ内の画面遷移をする時に中継が想定外の失敗を返すと、共通レイアウトの中に再試行と問い合わせの導線を持つエラーの表示を出し、再試行で文書を表示する', async ({
    page,
  }) => {
    await page.goto(HOME_HREF);
    await waitForHydration(page);
    const failedRelayRequests: string[] = [];
    await page.route(isRelayGraphQLURL, async (route) => {
      failedRelayRequests.push(route.request().method());
      await route.fulfill({
        status: INTERNAL_ERROR_RESPONSE.status,
        headers: INTERNAL_ERROR_RESPONSE.headers,
        json: INTERNAL_ERROR_RESPONSE.body,
      });
    });
    await page.evaluate((marker) => {
      Reflect.set(window, marker, true);
    }, SAME_DOCUMENT_MARKER);

    await footerPolicyNavigation(page)
      .getByRole('link', { name: TERMS_LABEL, exact: true })
      .click();

    await expect(page).toHaveURL((url) => url.pathname === TERMS_PATH);
    await expectUnexpectedErrorInLayout(page, TERMS_LABEL);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      INTERNAL_ERROR_RESPONSE.body.error.message,
    );
    expect(failedRelayRequests).toContain('POST');
    expect(
      await page.evaluate(
        (marker) => Reflect.get(window, marker) === true,
        SAME_DOCUMENT_MARKER,
      ),
      '同じ文書の中での遷移',
    ).toBe(true);

    await page.unroute(isRelayGraphQLURL);
    await page
      .getByRole('main')
      .getByRole('button', { name: RETRY_LABEL, exact: true })
      .click();

    await expectLoadedDocument(page);
    await expect(documentHeading(page, TERMS_LABEL)).toBeFocused();
  });

  test('サーバー側の描画でAPIサーバーからの取得に失敗すると、状態コード500で、共通レイアウトの中に再試行と問い合わせの導線を持つエラーの表示を出し、その文言はハイドレーションの後もAPIサーバーの想定内の文言のまま変わらない', async ({
    page,
    context,
    baseURL,
  }) => {
    const clientIp = await assumeDistinctClientIp(context, baseURL);

    // APIサーバーの制限の期間の境目をまたぐと回数が戻って取得が成功するため、500になるまで使い切りからやり直す
    let serverHtml = '';
    await expect(async () => {
      await exhaustApiIpRateLimit(clientIp);
      const response = await page.goto(TERMS_PATH);
      expect(response?.status()).toBe(500);
      serverHtml = (await response?.text()) ?? '';
    }).toPass({ timeout: RETRY_TIMEOUT_MS });

    await expectUnexpectedErrorInLayout(page, TERMS_LABEL);
    const serverAlertText = await page.evaluate(
      (source) =>
        new DOMParser()
          .parseFromString(source, 'text/html')
          .querySelector('main [role="alert"]')
          ?.textContent.trim() ?? null,
      serverHtml,
    );
    expect(serverAlertText).not.toBeNull();
    expect(serverAlertText).not.toBe(UNEXPECTED_ERROR_MESSAGE);

    await waitForHydration(page);

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      serverAlertText ?? '',
    );
  });
});
