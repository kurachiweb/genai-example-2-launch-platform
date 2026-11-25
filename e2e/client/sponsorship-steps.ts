import { expect, type Locator, type Page } from '@playwright/test';

import {
  CHECKOUT_ITEM_LABEL,
  CHECKOUT_RETURN_COMPLETED_MESSAGE,
  CHECKOUT_SUMMARY_TITLE,
  PURCHASED_DESTINATIONS,
} from '../../apps/client/src/components/payments/checkout-messages.ts';
import {
  DELETE_CANCEL_LABEL,
  DELETE_PRODUCT_LABEL,
  deleteConfirmTitleOf,
} from '../../apps/client/src/components/product/product-edit-messages.ts';
import {
  MY_SPONSORSHIP_ITEM_LABELS,
  MY_SPONSORSHIPS_HREF,
  MY_SPONSORSHIPS_PAGE_TITLE,
  PRODUCT_SPONSORSHIP_DELETE_NOTICE,
  SPONSORSHIP_APPLY_LINK_LABEL,
  SPONSORSHIP_APPLY_SUBMIT_LABEL,
  SPONSORSHIP_DATE_REASON_MESSAGES,
  SPONSORSHIP_FORM_LABELS,
  SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE,
  SPONSORSHIP_PRICING_SECTION_ID,
  SPONSORSHIP_PRICING_SECTION_TITLE,
  sponsoredAdLinkLabel,
  sponsorshipPlacementLabel,
} from '../../apps/client/src/components/sponsorship/sponsorship-messages.ts';
import { PRICING_HREF } from '../../apps/client/src/components/layout/site-links.ts';
import { PAYMENTS_UNAVAILABLE_REASON } from '../../apps/common-lib/payments/payments-unavailable-texts.ts';
import { PURCHASE_KIND_LABELS } from '../../apps/common-lib/payments/purchase-kinds.ts';
import { SPONSORSHIP_STATUS_LABELS } from '../../apps/common-lib/sponsorship/sponsorship-status.ts';
import {
  SPONSOR_LABEL_TEXT,
  SPONSORSHIP_TIER_LABELS,
  type SponsorshipTier,
} from '../../apps/common-lib/sponsorship/sponsorship-tiers.ts';
import { waitForBotToken } from '../support/bot-verification.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../support/mailpit.ts';
import { toBusinessDateTime } from '../../apps/backend-lib/core/time/business-time.ts';
import {
  addBusinessDays,
  isNearBusinessDayBoundary,
} from '../support/scheduled-trigger.ts';
import {
  createTestAccount,
  type TestAccount,
  userMenuButton,
} from './auth/account-steps.ts';
import { RETURN_COMPLETION_TIMEOUT_MS } from './checkout-steps.ts';
import {
  createProductInput,
  fillProduct,
  openProductEditor,
  openProductRegistration,
  type ProductInput,
  registerProduct,
  upcomingLaunchDates,
} from './product-steps.ts';
import { registerVerifiedAccount } from './profile-steps.ts';

export const SPONSORSHIP_TIMING_SKIP_REASON =
  '業務日付の境界の直前と0:07の掲載開始通知のジョブの前後は、当日開始の広告の掲載と通知の時期が変わり得るため、スポンサー広告のE2Eを飛ばします';

export const SPONSORSHIP_CHECKOUT_SKIP_REASON =
  'Stripeのsandboxのキーかスポンサー広告の価格(sponsorship_<ティア>_daily)を照会できない環境のため、料金ページからのスポンサー広告の申込と決済のE2Eを飛ばします';

export interface SponsorshipOwner {
  readonly account: TestAccount;
  readonly product: ProductInput;
}

export type SponsorshipCheckoutStart =
  { readonly kind: 'started' } | { readonly kind: 'payments_unavailable' };

export type SponsorshipDateField = 'start' | 'end';

const CHECKOUT_PATH_PATTERN = /^\/checkout\/[0-9A-HJKMNP-TV-Z]{26}$/u;

// カレンダーの部品の日本語の表記の「次の月へ」のボタン
const NEXT_MONTH_LABEL = '次の月へ';

// 掲載期間の確かめる日は今日から数日のため、最初に示す月から2回まで進めれば届く
const MAX_MONTH_MOVES = 2;

// 自分の広告一覧の状態は決済後のランディングの確認か決済の通知の受信で決済済みに変わるため、開き直しながら待つ
const STATUS_TIMEOUT_MS = 60_000;

// 掲載開始通知は決済の確定か0:07のジョブの後に、Queueを経てイベントサーバーが送る
const START_NOTICE_TIMEOUT_MS = 60_000;

// 区画へのスクロールがブラウザ内の遷移で起きたことを、ページの読み込み直しで消える目印で確かめる
const IN_PAGE_NAVIGATION_MARKER = '__sponsorshipE2eNavigationMarker';

// 0:07のジョブより前に決済が確定した当日開始の広告は、決済の確定ではなくそのジョブが通知するため、ジョブの起動の遅れも含めて0:15までを避ける
const DAILY_NOTICES_SETTLED_MINUTES = 15;

const MINUTES_PER_HOUR = 60;

export function isNearSponsorshipNoticeTiming(now: Date): boolean {
  const { hour, minute } = toBusinessDateTime(now);
  return (
    isNearBusinessDayBoundary(now) ||
    hour * MINUTES_PER_HOUR + minute < DAILY_NOTICES_SETTLED_MINUTES
  );
}

const DATE_FIELD_LABELS: Readonly<Record<SponsorshipDateField, string>> =
  Object.freeze({
    start: SPONSORSHIP_FORM_LABELS.startsOn,
    end: SPONSORSHIP_FORM_LABELS.endsOn,
  });

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// 定義リストの項目名に一致するdtの直後のddを返す
const definitionOf = (container: Locator, term: string): Locator =>
  container
    .locator('dt')
    .filter({ hasText: new RegExp(`^${escapeRegExp(term)}$`, 'u') })
    .locator('xpath=following-sibling::dd[1]');

// 件名はイベントサーバーのメールのテンプレート(sponsorship-start-notice-template.ts)が決める
export const sponsorshipStartNoticeSubject = (productName: string): string =>
  `${productName}のスポンサー広告掲載が始まりました`;

// 確認済みの利用者を画面で登録し、その利用者でプロダクトを画面で登録する。プロダクトのローンチは未確定のため、補助でキックオフ済みにしてから使う
export async function registerSponsorshipOwner(
  page: Page,
): Promise<SponsorshipOwner> {
  const account = createTestAccount();
  await registerVerifiedAccount(page, account);
  const product = createProductInput();
  const form = await openProductRegistration(page);
  const [launchDate] = upcomingLaunchDates();
  await fillProduct(page, form, product, launchDate);
  await registerProduct(page, form);
  return { account, product };
}

const placementOf = (page: Page, tier: SponsorshipTier): Locator =>
  page.getByRole('region', {
    name: sponsorshipPlacementLabel(tier),
    exact: true,
  });

// 指定したページのティアの位置に、ラベル「スポンサー」と、別タブで開く広告の印付きの外部Webサイトへのリンクを持つプロダクトの広告が出ることを確かめる。
// 広告の取得の失敗は位置ごと何も描かず、ローカルではAPIサーバーとイベントサーバーのD1のロックの競合(SQLITE_BUSY)で取得が失敗し得るため、開き直しながら待つ
export async function expectSponsoredAd(
  page: Page,
  path: string,
  tier: SponsorshipTier,
  product: Pick<ProductInput, 'name' | 'websiteUrl'>,
): Promise<void> {
  const adLink = page.getByRole('link', {
    name: sponsoredAdLinkLabel(product.name),
    exact: true,
  });
  const card = placementOf(page, tier)
    .getByRole('listitem')
    .filter({ has: adLink });
  const link = card.getByRole('link', {
    name: sponsoredAdLinkLabel(product.name),
    exact: true,
  });
  await expect(async () => {
    await page.goto(path);
    await expect(
      link,
      `${path}の${sponsorshipPlacementLabel(tier)}に「${product.name}」の広告がありません`,
    ).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await expect(link).toHaveAttribute('href', product.websiteUrl);
  await expect(link).toHaveAttribute('rel', 'sponsored noopener');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(
    card.getByText(SPONSOR_LABEL_TEXT, { exact: true }),
  ).toBeVisible();
}

// 指定したページから、プロダクトの広告が消えたことを確かめる。広告の取得が失敗しても位置ごと描かれず消えたように見えるため、
// ログイン中の利用者には広告が0件でも申込の導線とともに描かれるSilverの位置が出る(取得が成功した)まで開き直してから確かめる
export async function expectNoSponsoredAd(
  page: Page,
  path: string,
  product: Pick<ProductInput, 'name'>,
): Promise<void> {
  const silver = placementOf(page, 'silver');
  await expect(async () => {
    await page.goto(path);
    await expect(
      silver.getByRole('link', {
        name: SPONSORSHIP_APPLY_LINK_LABEL,
        exact: true,
      }),
      `${path}の${sponsorshipPlacementLabel('silver')}が描かれていません`,
    ).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await expect(
    page.getByRole('link', {
      name: sponsoredAdLinkLabel(product.name),
      exact: true,
    }),
  ).toHaveCount(0);
}

const mySponsorshipItemOf = (page: Page, productName: string): Locator =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { level: 2, name: productName }),
    });

// 自分の広告一覧を開き直しながら、プロダクトの申込の掲載状況が「掲載中」になるまで待つ
export async function expectActiveInMySponsorships(
  page: Page,
  productName: string,
): Promise<void> {
  const status = definitionOf(
    mySponsorshipItemOf(page, productName),
    MY_SPONSORSHIP_ITEM_LABELS.status,
  );
  await expect(async () => {
    await page.goto(MY_SPONSORSHIPS_HREF);
    await expect(
      page.getByRole('heading', { level: 1, name: MY_SPONSORSHIPS_PAGE_TITLE }),
    ).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
    await expect(status).toHaveText(SPONSORSHIP_STATUS_LABELS.active, {
      timeout: REACTION_TIMEOUT_MS,
    });
  }).toPass({ timeout: STATUS_TIMEOUT_MS });
}

// プロダクトの編集画面の削除の確認のダイアログに広告の注記が出ることを確かめ、削除せずに閉じる
export async function expectSponsorshipDeleteNotice(
  page: Page,
  productName: string,
): Promise<void> {
  await openProductEditor(page, productName);
  await page
    .getByRole('button', { name: DELETE_PRODUCT_LABEL, exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: deleteConfirmTitleOf(productName),
  });
  await expect(dialog).toContainText(PRODUCT_SPONSORSHIP_DELETE_NOTICE);
  await dialog
    .getByRole('button', { name: DELETE_CANCEL_LABEL, exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

const sponsorshipHeading = (page: Page): Locator =>
  page.getByRole('heading', {
    level: 2,
    name: SPONSORSHIP_PRICING_SECTION_TITLE,
    exact: true,
  });

// トップページは操作の前にハイドレーションの完了を待つ手掛かりが無いため、開閉にハイドレーションを要する利用者のメニューを一度開いて閉じる
export async function waitForHydration(
  page: Page,
  account: TestAccount,
): Promise<void> {
  const menu = page.getByRole('menu');
  await expect(async () => {
    if (!(await menu.isVisible())) {
      await userMenuButton(page, account).click();
    }
    await expect(menu).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

// トップページのSilverの位置の申込の導線から、ブラウザ内の遷移で料金ページのスポンサー広告の区画へ移り、区画の見出しまでスクロールすることを確かめる。
// 遷移がページの読み込みでないことは、読み込み直しで消える目印が残ることで確かめる
export async function openSponsorshipSectionFromTopPage(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await page.goto('/');
  await waitForHydration(page, account);
  await page.evaluate((marker) => {
    Reflect.set(window, marker, true);
  }, IN_PAGE_NAVIGATION_MARKER);
  await placementOf(page, 'silver')
    .getByRole('link', { name: SPONSORSHIP_APPLY_LINK_LABEL, exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === PRICING_HREF &&
      url.hash === `#${SPONSORSHIP_PRICING_SECTION_ID}`,
  );
  await expect(sponsorshipHeading(page)).toBeInViewport();
  // 料金ページの区画はUltrasの区画の後に並ぶため、見出しが画面に入るのはページの先頭からスクロールした場合だけである
  expect(
    await page.evaluate(() => window.scrollY),
    '区画の見出しまでスクロールしていません',
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      (marker) => Reflect.get(window, marker) === true,
      IN_PAGE_NAVIGATION_MARKER,
    ),
    '申込の導線がブラウザ内の遷移で料金ページを開いていません',
  ).toBe(true);
}

const applicationForm = (page: Page): Locator =>
  page.getByRole('form', { name: SPONSORSHIP_APPLY_LINK_LABEL });

// フォームの入力はハイドレーションの後でなければ状態に入らないため、ハイドレーションの後に描かれるbot判定のウィジェットのトークンを待つ
export async function waitForSponsorshipApplicationForm(
  page: Page,
): Promise<Locator> {
  const form = applicationForm(page);
  await waitForBotToken(form);
  return form;
}

export async function chooseSponsorshipProductAndTier(
  page: Page,
  form: Locator,
  productName: string,
  tier: SponsorshipTier,
): Promise<void> {
  await form
    .getByRole('combobox', { name: SPONSORSHIP_FORM_LABELS.product })
    .click();
  await page.getByRole('option', { name: productName, exact: true }).click();
  await form
    .getByRole('radio', { name: SPONSORSHIP_TIER_LABELS[tier], exact: true })
    .check();
}

// カレンダーの日のボタンは、業務日付と同じ暦日を日本語の完全な日付の表記で読み上げ、今日には前置き、選んだ日と選べない日には後置きが付く
const dayLabelOf = (businessDate: string): string =>
  new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${businessDate}T00:00:00.000Z`));

const dateGroupOf = (form: Locator, field: SponsorshipDateField): Locator =>
  form.getByRole('group', { name: DATE_FIELD_LABELS[field], exact: true });

const dayButtonOf = (
  form: Locator,
  field: SponsorshipDateField,
  businessDate: string,
): Locator =>
  dateGroupOf(form, field).getByRole('button', {
    name: new RegExp(
      `^(今日、)?${escapeRegExp(dayLabelOf(businessDate))}(、|$)`,
      'u',
    ),
  });

// カレンダーは選べる範囲の最初の月から描くため、日の月まで次の月へ進める
async function showDay(
  form: Locator,
  field: SponsorshipDateField,
  businessDate: string,
): Promise<Locator> {
  const day = dayButtonOf(form, field, businessDate);
  await expect(dateGroupOf(form, field)).toBeVisible();
  for (let moves = 0; moves < MAX_MONTH_MOVES; moves += 1) {
    if (await day.isVisible()) {
      break;
    }
    await dateGroupOf(form, field)
      .getByRole('button', { name: NEXT_MONTH_LABEL })
      .click();
  }
  return day;
}

// 開始日のカレンダーで、決済済みの広告の掲載期間の日が重なりの理由付きの選べない日として示され、終了日の翌日は選べることを確かめる
export async function expectOverlapDaysOnStartCalendar(
  form: Locator,
  period: { readonly startsOn: string; readonly endsOn: string },
): Promise<void> {
  const overlapReason = SPONSORSHIP_DATE_REASON_MESSAGES.overlap;
  for (
    let date = period.startsOn;
    date <= period.endsOn;
    date = addBusinessDays(date, 1)
  ) {
    const day = await showDay(form, 'start', date);
    await expect(day).toHaveAccessibleName(
      new RegExp(`、${escapeRegExp(overlapReason)}$`, 'u'),
    );
    await expect(day).toHaveAttribute('aria-disabled', 'true');
  }
  const dayAfter = await showDay(
    form,
    'start',
    addBusinessDays(period.endsOn, 1),
  );
  await expect(dayAfter).not.toHaveAttribute('aria-disabled', 'true');
  await expect(dayAfter).not.toHaveAccessibleName(
    new RegExp(escapeRegExp(overlapReason), 'u'),
  );
}

export async function chooseSponsorshipDate(
  form: Locator,
  field: SponsorshipDateField,
  businessDate: string,
): Promise<void> {
  const day = await showDay(form, field, businessDate);
  await expect(day).not.toHaveAttribute('aria-disabled', 'true');
  await day.click();
  await expect(day).toHaveAccessibleName(/、選択済み$/u);
}

const submitButtonOf = (form: Locator): Locator =>
  form.getByRole('button', {
    name: SPONSORSHIP_APPLY_SUBMIT_LABEL,
    exact: true,
  });

// 申込のボタンを押して決済画面へ移る。価格を照会できない環境では押す前から合計の位置に「現在表示できません」が出てボタンが無効になり、
// 決済を利用できない環境では押した後の決済の開始の失敗で決済を利用できない旨が出るため、その状態を返す
export async function startSponsorshipCheckout(
  page: Page,
  form: Locator,
): Promise<SponsorshipCheckoutStart> {
  if (
    await form
      .getByText(SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE, { exact: true })
      .isVisible()
  ) {
    await expect(submitButtonOf(form)).toBeDisabled();
    return { kind: 'payments_unavailable' };
  }
  const button = submitButtonOf(form);
  await expect(button).toBeEnabled();
  await button.click();
  const isCheckoutUrl = (url: URL): boolean =>
    CHECKOUT_PATH_PATTERN.test(url.pathname);
  const unavailable = form.getByText(PAYMENTS_UNAVAILABLE_REASON);
  await expect(async () => {
    expect(
      isCheckoutUrl(new URL(page.url())) || (await unavailable.isVisible()),
      '決済画面へ移るか、決済を利用できない旨が出ること',
    ).toBe(true);
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  if (!isCheckoutUrl(new URL(page.url()))) {
    return { kind: 'payments_unavailable' };
  }
  await expect(
    definitionOf(checkoutSummary(page), CHECKOUT_ITEM_LABEL),
  ).toContainText(PURCHASE_KIND_LABELS.sponsorship);
  return { kind: 'started' };
}

const checkoutSummary = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: CHECKOUT_SUMMARY_TITLE, exact: true });

// 決済後のランディングの完了の表示から、購入した対象を確かめる導線で自分の広告一覧へ移る
export async function openMySponsorshipsFromReturn(page: Page): Promise<void> {
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    CHECKOUT_RETURN_COMPLETED_MESSAGE,
    { timeout: RETURN_COMPLETION_TIMEOUT_MS },
  );
  await expect(
    definitionOf(checkoutSummary(page), CHECKOUT_ITEM_LABEL),
  ).toContainText(PURCHASE_KIND_LABELS.sponsorship);
  const destination = PURCHASED_DESTINATIONS.SPONSORSHIP;
  if (destination === undefined) {
    throw new Error('スポンサー広告の購入の後の導線が定義されていません');
  }
  await page
    .getByRole('main')
    .getByRole('link', { name: destination.label, exact: true })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === MY_SPONSORSHIPS_HREF);
}

// 掲載開始通知メールが届き、本文に自分の広告一覧へのリンクがあることを確かめる
export async function expectSponsorshipStartNotice(
  account: TestAccount,
  productName: string,
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    {
      to: account.email,
      subject: sponsorshipStartNoticeSubject(productName),
      receivedAfter,
    },
    { timeoutMs: START_NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(productName);
  expect(
    mail.links.some((link) => new URL(link).pathname === MY_SPONSORSHIPS_HREF),
    '自分の広告一覧への導線',
  ).toBe(true);
  return mail;
}
