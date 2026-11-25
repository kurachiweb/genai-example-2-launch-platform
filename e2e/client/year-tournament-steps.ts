import { expect, type Locator, type Page } from '@playwright/test';

import {
  BRACKET_MATCH_STATUS_LABELS,
  BRACKET_SCROLL_REGION_LABEL,
} from '../../apps/client/src/components/bracket/bracket-messages.ts';
import { yearBracketHref } from '../../apps/client/src/components/layout/site-links.ts';
import {
  CHECKOUT_ITEM_LABEL,
  CHECKOUT_RETURN_COMPLETED_MESSAGE,
  CHECKOUT_SUMMARY_TITLE,
} from '../../apps/client/src/components/payments/checkout-messages.ts';
import { BRACKET_LINK_LABEL } from '../../apps/client/src/components/tournament/tournament-copy.ts';
import {
  TROPHY_AWARD_NAMES,
  TROPHY_SHELF_TITLE,
  trophyBracketLinkLabel,
} from '../../apps/client/src/components/trophy/trophy-messages.ts';
import {
  YEAR_ENTRY_BUTTON_LABEL,
  YEAR_ENTRY_ENTITLED_MESSAGE,
} from '../../apps/client/src/components/year-tournament/year-entry-messages.ts';
import {
  YEAR_FINAL_BADGE,
  YEAR_FINAL_SUBTITLE,
  YEAR_FINAL_TITLE,
  YEAR_TOURNAMENT_SECTION_TITLE,
} from '../../apps/client/src/components/year-tournament/year-tournament-messages.ts';
import { PAYMENTS_UNAVAILABLE_REASON } from '../../apps/common-lib/payments/payments-unavailable-texts.ts';
import { PURCHASE_KIND_LABELS } from '../../apps/common-lib/payments/purchase-kinds.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import type {
  YearTournamentEntrant,
  YearTournamentFixture,
} from '../support/year-tournament-fixtures.ts';
import { createTestAccount } from './auth/account-steps.ts';
import { RETURN_COMPLETION_TIMEOUT_MS } from './checkout-steps.ts';
import { productPagePath } from './directory-steps.ts';
import { matchCardOf } from './match-steps.ts';
import {
  openProfileEditor,
  readCurrentHandle,
  registerVerifiedAccount,
} from './profile-steps.ts';

export const YEAR_ENTRY_CHECKOUT_SKIP_REASON =
  'Stripeのsandboxのキーか参加費の価格(year_tournament_entry)を照会できない環境のため、Yearトーナメントの参加費の決済のE2Eを飛ばします';

export interface YearEntrantOwner {
  readonly handle: string;
}

export type YearEntryCheckoutStart =
  { readonly kind: 'started' } | { readonly kind: 'payments_unavailable' };

const TOP_PAGE_PATH = '/';

const CHECKOUT_PATH_PATTERN = /^\/checkout\/[0-9A-HJKMNP-TV-Z]{26}$/u;

// 決勝の確定の後の進行と受賞の記録は、23:45の起動の後にAPIサーバーとイベントサーバーが続けて行うため、取得し直しながら待つ
const TROPHY_TIMEOUT_MS = 90_000;

const YEAR_FINAL_REGION_NAME = new RegExp(
  `^${YEAR_FINAL_TITLE}\\s*${YEAR_FINAL_SUBTITLE}$`,
  'u',
);

// 対象年の表記はAPIサーバーが返す「<年>年」
const yearLabelOf = (fixture: YearTournamentFixture): string =>
  `${String(fixture.year)}年`;

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// 定義リストの項目名に一致するdtの直後のddを返す
const definitionOf = (container: Locator, term: string): Locator =>
  container
    .locator('dt')
    .filter({ hasText: new RegExp(`^${escapeRegExp(term)}$`, 'u') })
    .locator('xpath=following-sibling::dd[1]');

const finalistNamesOf = (
  fixture: YearTournamentFixture,
): readonly [string, string] => [
  fixture.open.productName,
  fixture.ultras.productName,
];

// 補助(a)の受付中の枠の投稿者になる、メールアドレスを確認済みの利用者を画面で登録し、初期のハンドルをプロフィールの編集画面から読む
export async function registerYearEntrantOwner(
  page: Page,
): Promise<YearEntrantOwner> {
  const account = createTestAccount();
  await registerVerifiedAccount(page, account);
  const form = await openProfileEditor(page, account);
  return { handle: await readCurrentHandle(form) };
}

const yearEntryPanel = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('group', { name: YEAR_TOURNAMENT_SECTION_TITLE, exact: true });

// ボタンの名前は見える文言に参加費を続ける。送信中は文言が変わる
const yearEntryButton = (page: Page): Locator =>
  yearEntryPanel(page).getByRole('button', {
    name: new RegExp(`^${escapeRegExp(YEAR_ENTRY_BUTTON_LABEL)}`, 'u'),
  });

export async function openProductPage(
  page: Page,
  entrant: YearTournamentEntrant,
): Promise<void> {
  await page.goto(productPagePath(entrant.productHandle));
  await expect(
    page.getByRole('heading', { level: 1, name: entrant.productName }),
  ).toBeVisible();
}

// 参加費の導線のボタンを押して決済画面へ移る。参加費を照会できない環境では押す前から、決済を利用できない環境では押した後の決済の開始の失敗で、ボタンが理由とともに無効になるため、その状態を返す。
// 決済を利用できない旨以外の理由で無効になった場合は失敗させる。
// ボタンはbot判定のウィジェットを持たずハイドレーションの完了を待つ手掛かりが無いため、決済画面へ移るかボタンが無効になるまで押し直す。押下が効くと文言が送信中に変わり元の名前のボタンが消えるため、元の名前のボタンが見えている間だけ押す
export async function startYearEntryCheckout(
  page: Page,
): Promise<YearEntryCheckoutStart> {
  const button = yearEntryButton(page);
  await expect(button).toBeVisible();
  const isCheckoutUrl = (url: URL): boolean =>
    CHECKOUT_PATH_PATTERN.test(url.pathname);
  const onCheckout = (): boolean => isCheckoutUrl(new URL(page.url()));
  await expect(async () => {
    if (!onCheckout() && (await button.isVisible())) {
      if (await button.isDisabled({ timeout: REACTION_TIMEOUT_MS })) {
        return;
      }
      await button.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(page).toHaveURL(isCheckoutUrl, {
      timeout: REACTION_TIMEOUT_MS,
    });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  if (!onCheckout()) {
    await expect(
      yearEntryPanel(page).getByText(PAYMENTS_UNAVAILABLE_REASON),
      '参加費の導線のボタンが無効な理由',
    ).toBeVisible();
    return { kind: 'payments_unavailable' };
  }
  await expectYearEntryCheckoutItem(page);
  return { kind: 'started' };
}

const checkoutSummary = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: CHECKOUT_SUMMARY_TITLE, exact: true });

async function expectYearEntryCheckoutItem(page: Page): Promise<void> {
  await expect(
    definitionOf(checkoutSummary(page), CHECKOUT_ITEM_LABEL),
  ).toContainText(PURCHASE_KIND_LABELS.year_tournament_entry);
}

export async function expectYearEntryCompletedReturn(
  page: Page,
): Promise<void> {
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    CHECKOUT_RETURN_COMPLETED_MESSAGE,
    { timeout: RETURN_COMPLETION_TIMEOUT_MS },
  );
  await expectYearEntryCheckoutItem(page);
}

// 参加資格の反映は決済後のランディングの確認か通知の受信で起きるため、プロダクト詳細ページを開き直しながら待つ
export async function expectYearEntryEntitled(
  page: Page,
  entrant: YearTournamentEntrant,
): Promise<void> {
  await expect(async () => {
    await openProductPage(page, entrant);
    await expect(yearEntryPanel(page)).toContainText(
      YEAR_ENTRY_ENTITLED_MESSAGE.lead,
      { timeout: REACTION_TIMEOUT_MS },
    );
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await expect(yearEntryButton(page)).toHaveCount(0);
}

// 画面幅768px以上ではブラケットを列で描くため、横スクロールの領域の中から2つのプロダクトの対戦のマッチを探す
const bracketMatchOf = (
  page: Page,
  fixture: YearTournamentFixture,
): Locator => {
  const [first, second] = finalistNamesOf(fixture);
  return page
    .getByRole('region', { name: BRACKET_SCROLL_REGION_LABEL, exact: true })
    .getByRole('article')
    .filter({ hasText: first })
    .filter({ hasText: second });
};

// 対象年のブラケットのページを開き、組み合わせ決定で予定された決勝に2つのプロダクトと「予定」の印が出ることを確かめる
export async function expectScheduledFinalOnBracket(
  page: Page,
  fixture: YearTournamentFixture,
): Promise<void> {
  await page.goto(yearBracketHref(fixture.year));
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: YEAR_TOURNAMENT_SECTION_TITLE,
    }),
  ).toContainText(yearLabelOf(fixture));
  const match = bracketMatchOf(page, fixture);
  await expect(
    match,
    `${yearLabelOf(fixture)}のブラケットに「${fixture.open.productName}」と「${fixture.ultras.productName}」の決勝がありません。組み合わせ決定(23:45のジョブ)の結果を確かめてください`,
  ).toBeVisible();
  await expect(match).toContainText(BRACKET_MATCH_STATUS_LABELS.scheduled);
}

// 同じ日に他のテストのYearの決勝が並び得るため、決勝の区画は2つのプロダクトの対戦カードを持つものに絞る
const yearFinalRegion = (page: Page, fixture: YearTournamentFixture): Locator =>
  page
    .getByRole('region', { name: YEAR_FINAL_REGION_NAME })
    .filter({ has: matchCardOf(page, finalistNamesOf(fixture)) });

// トップページのYearの決勝の区画に、印「Year Final」・対象年の表記・その年のブラケットのページへの導線と、2つのプロダクトの対戦カードが出ることを確かめる
export async function expectYearFinalOnTopPage(
  page: Page,
  fixture: YearTournamentFixture,
): Promise<void> {
  await page.goto(TOP_PAGE_PATH);
  const region = yearFinalRegion(page, fixture);
  await expect(
    region,
    `トップページのYearの決勝の区画に「${fixture.open.productName}」と「${fixture.ultras.productName}」の対戦カードがありません。決勝の開始の補助の結果を確かめてください`,
  ).toBeVisible();
  await expect(region).toContainText(YEAR_FINAL_BADGE);
  await expect(region).toContainText(yearLabelOf(fixture));
  await expect(
    region.getByRole('link', { name: BRACKET_LINK_LABEL, exact: true }),
  ).toHaveAttribute('href', yearBracketHref(fixture.year));
}

const trophyShelf = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: TROPHY_SHELF_TITLE, exact: true });

// 受賞したプロダクトの詳細ページのトロフィーの区画に、その年のProduct of the Yearとその年のブラケットのページへの導線が出るまで開き直しながら待つ
export async function expectYearTrophy(
  page: Page,
  fixture: YearTournamentFixture,
  champion: YearTournamentEntrant,
): Promise<void> {
  const yearLabel = yearLabelOf(fixture);
  const trophy = trophyShelf(page)
    .getByRole('listitem')
    .filter({ hasText: TROPHY_AWARD_NAMES.YEAR })
    .filter({ hasText: yearLabel });
  await expect(async () => {
    await openProductPage(page, champion);
    await expect(trophy).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: TROPHY_TIMEOUT_MS });
  await expect(
    trophy.getByRole('link', {
      name: trophyBracketLinkLabel(yearLabel),
      exact: true,
    }),
  ).toHaveAttribute('href', yearBracketHref(fixture.year));
}
