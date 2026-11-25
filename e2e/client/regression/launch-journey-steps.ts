import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, type Locator, type Page, test } from '@playwright/test';

import {
  WEEK_ENTRY_BUTTON_LABEL,
  WEEK_ENTRY_EXEMPT_MESSAGE,
} from '../../../apps/client/src/components/week-tournament/week-entry-messages.ts';
import { WEEK_TOURNAMENT_SECTION_TITLE } from '../../../apps/client/src/components/week-tournament/week-tournament-messages.ts';
import { scanPage } from '../../support/a11y-scan.ts';
import { executeLocalD1 } from '../../support/local-d1.ts';
import {
  entitleOpenEntryWithoutPayment,
  type WeekTournamentFixture,
} from '../../support/week-tournament-fixtures.ts';
import { createTestAccount, type TestAccount } from '../auth/account-steps.ts';
import {
  confirmPayment,
  preparePaymentWithTestCard,
} from '../checkout-steps.ts';
import {
  createProductInput,
  fillProduct,
  openProductRegistration,
  type ProductInput,
  registerProduct,
  upcomingLaunchDates,
} from '../product-steps.ts';
import {
  openProfileEditor,
  readCurrentHandle,
  registerVerifiedAccount,
} from '../profile-steps.ts';
import {
  expectWeekEntryCompletedReturn,
  expectWeekEntryEntitled,
  openProductPage,
  startWeekEntryCheckout,
} from '../week-tournament-steps.ts';
import { endQualifierMatchSql } from './launch-journey-sql.ts';

export interface JourneyOwner {
  readonly account: TestAccount;
  readonly product: ProductInput;
}

const REGISTER_PATH = '/auth/register';

const ENDED_AGO_MS = 60_000;

const runFile = promisify(execFile);

export const BUSINESS_DAY_BOUNDARY_SKIP_REASON =
  '業務日付の境界の直前は、決勝を今日へ移した後に業務日付が変わり得るため、公開までの流れの後半(Weekトーナメント)を飛ばします';

export const STRIPE_FORWARDING_SKIP_REASON =
  'Stripeの決済の通知の転送(`stripe listen`)が起動していないため、参加費の決済を飛ばし、決済済みの状態を補助で作って続けます';

export const PAYMENTS_UNAVAILABLE_SKIP_REASON =
  'Stripeのsandboxのキーか参加費の価格を照会できないため、参加費の決済を飛ばし、決済済みの状態を補助で作って続けます';

// 違反は1画面で止めず全画面の検査を終えてから失敗させ、違反の規則・影響度・要素を出力に残す
export async function expectNoA11yViolations(
  page: Page,
  route: string,
  state: string,
): Promise<void> {
  const violations = await scanPage(page, { route, state });
  expect
    .soft(
      violations,
      `${route}(${state})にアクセシビリティの違反があります: ${JSON.stringify(violations)}`,
    )
    .toEqual([]);
}

export function skipPart(reason: string): void {
  test.info().annotations.push({ type: '対象外', description: reason });
}

// 確認のメールを受け取るまでを含め、メールアドレスを確認済みの利用者として登録する。登録の画面は登録の前に検査する
export async function registerJourneyUser(
  page: Page,
  { scanRegisterPage = false }: { readonly scanRegisterPage?: boolean } = {},
): Promise<TestAccount> {
  const account = createTestAccount();
  if (scanRegisterPage) {
    await page.goto(REGISTER_PATH);
    await expectNoA11yViolations(page, REGISTER_PATH, 'signed-out');
  }
  await registerVerifiedAccount(page, account);
  return account;
}

export async function readJourneyUserHandle(
  page: Page,
  account: TestAccount,
): Promise<string> {
  return readCurrentHandle(await openProfileEditor(page, account));
}

// ローンチ日は画面で選べる日に登録し、後で当日へ書き換える。専用のカテゴリで登録し、他のテストの残りのローンチと組まれないようにする
export async function registerJourneyOwner(
  page: Page,
  categoryName: string,
  options: { readonly scanRegisterPage?: boolean } = {},
): Promise<JourneyOwner> {
  const account = await registerJourneyUser(page, options);
  const product = { ...createProductInput(), categoryName };
  const [launchDate] = upcomingLaunchDates();
  const form = await openProductRegistration(page);
  await expectNoA11yViolations(page, '/my/products/new', 'signed-in');
  await fillProduct(page, form, product, launchDate);
  await registerProduct(page, form);
  await expectNoA11yViolations(page, '/my/products', 'with-data');
  return { account, product };
}

export async function endQualifierMatch(
  productHandles: readonly string[],
): Promise<void> {
  const now = new Date();
  const ended = await executeLocalD1(
    endQualifierMatchSql(
      productHandles,
      new Date(now.getTime() - ENDED_AGO_MS),
      now,
    ),
  );
  if (ended.length !== 1) {
    throw new Error(
      `終了の日時を移した予選のマッチが${String(ended.length)}件でした。プロダクト(${productHandles.join(', ')})が当日の1つのマッチで対戦中である必要があります`,
    );
  }
}

// 決済の通知はstripe listenの転送でイベントサーバーへ届く。転送が無いと支払いの後に参加資格が反映されないため、支払いの前に転送のプロセスの有無で前提を確かめる。確かめられない環境(pgrepが無いなど)は転送が無いものとして扱う
export async function isStripeForwardingRunning(): Promise<boolean> {
  try {
    await runFile('pgrep', ['-f', '[s]tripe listen']);
    return true;
  } catch {
    return false;
  }
}

const weekEntryPanel = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('group', { name: WEEK_TOURNAMENT_SECTION_TITLE, exact: true });

// 補助は決済の記録を持たず出どころをUltrasにするため、画面には参加費の免除の表示が出て、参加の操作は出ない
async function expectWeekEntryExempt(
  page: Page,
  fixture: WeekTournamentFixture,
): Promise<void> {
  await openProductPage(page, fixture.open);
  await expect(weekEntryPanel(page)).toContainText(WEEK_ENTRY_EXEMPT_MESSAGE);
  await expect(
    weekEntryPanel(page).getByRole('button', {
      name: WEEK_ENTRY_BUTTON_LABEL,
    }),
  ).toHaveCount(0);
}

// 参加費を画面でテストカードで支払い、参加資格を得たことを確かめる。決済の転送が無い環境と決済を利用できない環境では対象外である旨を表示し、決済済みの状態を補助で作って続ける
export async function enterWeekTournament(
  page: Page,
  fixture: WeekTournamentFixture,
): Promise<void> {
  const forwarding = await isStripeForwardingRunning();
  if (!forwarding) {
    skipPart(STRIPE_FORWARDING_SKIP_REASON);
  }
  const start = forwarding ? await startWeekEntryCheckout(page) : undefined;
  if (start?.kind === 'payments_unavailable') {
    skipPart(PAYMENTS_UNAVAILABLE_SKIP_REASON);
  }
  if (start?.kind !== 'started') {
    await entitleOpenEntryWithoutPayment(fixture);
    await expectWeekEntryExempt(page, fixture);
    return;
  }
  await expectNoA11yViolations(page, '/checkout/$purchaseId', 'signed-in');
  await preparePaymentWithTestCard(page);
  await confirmPayment(page);
  await expectWeekEntryCompletedReturn(page);
  await expectWeekEntryEntitled(page, fixture.open);
}
