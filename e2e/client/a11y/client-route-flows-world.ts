import type { Browser } from '@playwright/test';

import { isoWeekKey } from '../../../apps/common-lib/tournament/week-period.ts';
import { createListedProducts } from '../../support/directory-fixtures.ts';
import type { LegalDocumentKind } from '../../../apps/common-lib/legal/legal-documents.ts';
import { signInAsNewAdmin } from '../../support/admin-bootstrap.ts';
import { executeLocalD1 } from '../../support/local-d1.ts';
import {
  createUnsubscribeToken,
  findUserIdByEmail,
} from '../../support/notification-fixtures.ts';
import {
  addBusinessDays,
  businessDateOf,
  isNearBusinessDayBoundary,
} from '../../support/scheduled-trigger.ts';
import {
  createPaidSponsorship,
  kickOffProduct,
} from '../../support/sponsorship-fixtures.ts';
import {
  closeWeekTournamentEntry,
  createWeekTournamentEntrants,
  entitleOpenEntryWithoutPayment,
  runWeekEveningJobs,
  startWeekFinalToday,
} from '../../support/week-tournament-fixtures.ts';
import {
  closeYearTournamentEntry,
  createYearTournamentEntrants,
  entitleOpenYearEntryWithoutPayment,
  startYearFinalToday,
} from '../../support/year-tournament-fixtures.ts';
import { createTestAccount } from '../auth/account-steps.ts';
import { openBillingFromSettingsNavigation } from '../billing-steps.ts';
import {
  confirmPayment,
  preparePaymentWithTestCard,
  startSmokeCheckout,
} from '../checkout-steps.ts';
import { registerSponsorshipOwner } from '../sponsorship-steps.ts';
import { registerVerifiedAccount } from '../profile-steps.ts';
import { publishLegalDocument } from './legal-publish-steps.ts';
import { emptyUserWorld } from './client-route-world.ts';
import { cachedWorld } from './route-world-cache.ts';
import { type StorageState, withSessionPage } from './route-sessions.ts';

export interface Unavailable {
  readonly unavailable: string;
}

export const isUnavailable = (value: object): value is Unavailable =>
  'unavailable' in value && typeof value.unavailable === 'string';

export interface CheckoutWorld {
  readonly purchaseId: string;
  readonly storageState: StorageState;
}

export interface PaidCheckoutWorld {
  readonly returnPath: string;
  readonly storageState: StorageState;
}

export interface SponsorshipWorld {
  readonly storageState: StorageState;
}

export interface TournamentWorld {
  readonly week: string;
  readonly year: string;
}

export interface ListedProductsWorld {
  readonly firstHandle: string;
}

export interface LegalWorld {
  readonly latestVersion: number;
}

export const PAYMENTS_UNAVAILABLE_REASON =
  'Stripeのsandboxのキーか決済の転送が無い環境のため、決済に依存する画面の検査を飛ばします';

const SPONSORSHIP_START_OFFSET_DAYS = 30;

// 決済の開始までを済ませて支払わずに残し、決済の画面を後から開けるようにする
export const checkoutWorld = (
  browser: Browser,
): Promise<CheckoutWorld | Unavailable> =>
  cachedWorld('checkout', () =>
    withSessionPage(browser, 'client', async (page, context) => {
      const account = createTestAccount();
      await registerVerifiedAccount(page, account);
      await openBillingFromSettingsNavigation(page, account);
      const start = await startSmokeCheckout(page);
      if (start.kind === 'payments_unavailable') {
        return { unavailable: PAYMENTS_UNAVAILABLE_REASON };
      }
      return {
        purchaseId: start.purchaseId,
        storageState: await context.storageState(),
      };
    }),
  );

// テストカードで支払い、決済後のランディングのURLを残す。決済履歴にはこの利用者の記録が並ぶ
export const paidCheckoutWorld = (
  browser: Browser,
): Promise<PaidCheckoutWorld | Unavailable> =>
  cachedWorld('paid-checkout', () =>
    withSessionPage(browser, 'client', async (page, context) => {
      const account = createTestAccount();
      await registerVerifiedAccount(page, account);
      await openBillingFromSettingsNavigation(page, account);
      const start = await startSmokeCheckout(page);
      if (start.kind === 'payments_unavailable') {
        return { unavailable: PAYMENTS_UNAVAILABLE_REASON };
      }
      await preparePaymentWithTestCard(page);
      await confirmPayment(page);
      const { pathname, search } = new URL(page.url());
      return {
        returnPath: `${pathname}${search}`,
        storageState: await context.storageState(),
      };
    }),
  );

// 掲載の開始日を遠い未来にして、他のE2Eが確かめる各ページの広告の枠に現れないようにする
export const sponsorshipWorld = (browser: Browser): Promise<SponsorshipWorld> =>
  cachedWorld('sponsorship', () =>
    withSessionPage(browser, 'client', async (page, context) => {
      const owner = await registerSponsorshipOwner(page);
      const product = await kickOffProduct(owner.product.handle);
      await createPaidSponsorship(product, {
        tier: 'silver',
        startsOn: addBusinessDays(
          businessDateOf(new Date()),
          SPONSORSHIP_START_OFFSET_DAYS,
        ),
      });
      return { storageState: await context.storageState() };
    }),
  );

export const TOURNAMENT_BOUNDARY_REASON =
  '業務日付の境界の直前は、決勝を今日へ移した後に業務日付が変わり得るため、トーナメントのブラケットの検査を飛ばします';

// WeekとYearの組み合わせを同じ夜の処理で決め、決勝を今日の進行中にする
export const tournamentWorld = (): Promise<TournamentWorld | Unavailable> =>
  cachedWorld('tournament', async () => {
    if (isNearBusinessDayBoundary(new Date())) {
      return { unavailable: TOURNAMENT_BOUNDARY_REASON };
    }
    const week = await createWeekTournamentEntrants();
    const year = await createYearTournamentEntrants();
    await entitleOpenEntryWithoutPayment(week);
    await entitleOpenYearEntryWithoutPayment(year);
    await closeWeekTournamentEntry(week);
    await closeYearTournamentEntry(year);
    await runWeekEveningJobs();
    await startWeekFinalToday(week);
    await startYearFinalToday(year);
    return { week: isoWeekKey(week.weekStart), year: String(year.year) };
  });

export const listedProductsWorld = (): Promise<ListedProductsWorld> =>
  cachedWorld('listed-products', async () => {
    const { products } = await createListedProducts();
    const [first] = products;
    if (first === undefined) {
      throw new Error('掲載中のプロダクトを作れませんでした');
    }
    return { firstHandle: first.handle };
  });

export async function readLegalLatestVersions(): Promise<
  Readonly<Record<string, number>>
> {
  const rows = await executeLocalD1(
    'SELECT kind, latest_version_number AS latest FROM legal_documents;',
  );
  return Object.fromEntries(
    rows.map((row) => [String(row.kind), Number(row.latest)]),
  );
}

// 法務文書の公開に要るロールは最上位管理者だけのため、モデレーターの管理者とは別に用意する
const legalPublisherWorld = (
  browser: Browser,
): Promise<{ readonly storageState: StorageState }> =>
  cachedWorld('legal-publisher', () =>
    withSessionPage(browser, 'admin', async (page, context) => {
      await signInAsNewAdmin(page, { role: 'super_admin' });
      return { storageState: await context.storageState() };
    }),
  );

// 公開済みの版がある種別はそのまま使い、無い種別だけを1度公開する。公開は取り消せないため、検査のために公開する版は1種別につき1つに限る
export const publishedLegalWorld = (
  browser: Browser,
  kind: LegalDocumentKind,
): Promise<LegalWorld> =>
  cachedWorld(`legal-published-${kind}`, async () => {
    const before = (await readLegalLatestVersions())[kind] ?? 0;
    if (before > 0) {
      return { latestVersion: before };
    }
    const publisher = await legalPublisherWorld(browser);
    await withSessionPage(
      browser,
      'admin',
      (page) => publishLegalDocument(page, kind),
      publisher.storageState,
    );
    const after = (await readLegalLatestVersions())[kind] ?? 0;
    if (after < 1) {
      throw new Error(`${kind}を公開しましたが、公開済みの版を確認できません`);
    }
    return { latestVersion: after };
  });

// 配信停止のトークンは利用者と種別ごとに1つしか作れないため、作ったトークンを残して使い回す
export const unsubscribeUserWorld = (
  browser: Browser,
): Promise<{ readonly token: string }> =>
  cachedWorld('unsubscribe-token', async () => {
    const user = await emptyUserWorld(browser);
    const userId = await findUserIdByEmail(user.account.email);
    return { token: await createUnsubscribeToken(userId, 'match_result') };
  });
