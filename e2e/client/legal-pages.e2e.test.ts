import { expect, type Locator, type Page, test } from '@playwright/test';

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

const footerPolicyNavigation = (page: Page): Locator =>
  page
    .getByRole('contentinfo')
    .getByRole('navigation', { name: FOOTER_POLICY_NAVIGATION_LABEL });

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
      .or(main.getByText(LAST_REVISED_LABEL, { exact: true })),
  ).toBeVisible();
  await expect(main.getByRole('alert')).toHaveCount(0);
}

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
      await expect(
        page
          .getByRole('main')
          .getByRole('heading', { level: 1, name: label, exact: true }),
      ).toBeVisible();
      await expectLoadedDocument(page);
      await expectFooterLegalLinks(page);
    });
  }
});
