import { DIRECTORY_HREF } from '../../apps/client/src/components/layout/site-links.ts';
import { SPONSORSHIP_APPLY_HREF } from '../../apps/client/src/components/sponsorship/sponsorship-messages.ts';
import { SPONSORSHIP_TIER_LABELS } from '../../apps/common-lib/sponsorship/sponsorship-tiers.ts';
import {
  addBusinessDays,
  businessDateOf,
  isNearBusinessDayBoundary,
  triggerScheduled,
} from '../support/scheduled-trigger.ts';
import {
  createPaidSponsorship,
  decideKickedOffLaunchAsLost,
  kickOffProduct,
} from '../support/sponsorship-fixtures.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  CHECKOUT_FLOW_TIMEOUT_MS,
  confirmPayment,
  preparePaymentWithTestCard,
} from './checkout-steps.ts';
import { productPagePath } from './directory-steps.ts';
import { PRODUCT_FLOW_TIMEOUT_MS } from './product-steps.ts';
import {
  chooseSponsorshipDate,
  chooseSponsorshipProductAndTier,
  expectActiveInMySponsorships,
  expectOverlapDaysOnStartCalendar,
  expectSponsoredAd,
  expectSponsorshipDeleteNotice,
  expectSponsorshipStartNotice,
  isNearSponsorshipNoticeTiming,
  openMySponsorshipsFromReturn,
  openSponsorshipSectionFromTopPage,
  registerSponsorshipOwner,
  SPONSORSHIP_CHECKOUT_SKIP_REASON,
  SPONSORSHIP_TIMING_SKIP_REASON,
  startSponsorshipCheckout,
  waitForSponsorshipApplicationForm,
} from './sponsorship-steps.ts';

// 利用者の登録とメールの確認、画像の送信を含むプロダクトの登録に加え、3つのページ・自分の広告一覧・削除の確認・料金ページの確認と通知の待ちを1つの流れで行う
const FIXTURE_FLOW_TIMEOUT_MS = PRODUCT_FLOW_TIMEOUT_MS + 120_000;

// 掲載期間の日が料金ページのカレンダーで重なりとして示されることを数日にわたって確かめつつ、前回までの実行の広告が並ぶ期間を短くする
const FIXTURE_DAYS = 3;

const BUSINESS_DAY_BOUNDARY_SKIP_REASON =
  '業務日付の境界の直前は、今日から始まる広告を作った後に業務日付が変わり得るため、スポンサー広告のE2Eを飛ばします';

test.describe('スポンサー広告の掲載と通知(補助の決済済みの申込)', () => {
  test('キックオフ済みのプロダクトの決済済みのLegendの申込が、トップページ・ディレクトリ・プロダクト詳細ページにラベルと広告のリンクの印付きで出て、自分の広告一覧に「掲載中」、削除の確認に広告の注記が出て、料金ページのカレンダーでは同じティアの掲載期間の日が重なりの理由付きで選べず、0:07のジョブで掲載開始通知が届く', async ({
    page,
  }) => {
    test.setTimeout(FIXTURE_FLOW_TIMEOUT_MS);
    test.skip(
      isNearBusinessDayBoundary(new Date()),
      BUSINESS_DAY_BOUNDARY_SKIP_REASON,
    );
    const { account, product } = await registerSponsorshipOwner(page);
    const sponsorProduct = await kickOffProduct(product.handle);
    const today = businessDateOf(new Date());
    const sponsorship = await createPaidSponsorship(sponsorProduct, {
      tier: 'legend',
      startsOn: today,
      endsOn: addBusinessDays(today, FIXTURE_DAYS - 1),
    });

    await expectSponsoredAd(page, '/', 'legend', product);
    await expectSponsoredAd(page, DIRECTORY_HREF, 'legend', product);
    // 予選を勝っていないプロダクトの詳細ページは投稿者にだけ開くため、投稿者のままで確かめる
    await expectSponsoredAd(
      page,
      productPagePath(product.handle),
      'legend',
      product,
    );
    await expectActiveInMySponsorships(page, product.name);
    await decideKickedOffLaunchAsLost(sponsorProduct);
    await expectSponsorshipDeleteNotice(page, product.name);

    await openSponsorshipSectionFromTopPage(page, account);
    const form = await waitForSponsorshipApplicationForm(page);
    await chooseSponsorshipProductAndTier(page, form, product.name, 'legend');
    await expectOverlapDaysOnStartCalendar(form, sponsorship);

    const triggeredAt = new Date();
    await triggerScheduled({
      worker: 'api',
      businessDate: today,
      businessTime: '00:07',
    });
    await expectSponsorshipStartNotice(account, product.name, triggeredAt);
  });
});

// 申込の決済はStripeのsandboxに購入を作り、決済の通知はstripe listenの転送でイベントサーバーへ届く
test.describe('スポンサー広告の申込と決済(実行のたびにsandboxに決済が1つ残る)', () => {
  test('キックオフ済みのプロダクトの投稿者が料金ページのカレンダーで今日だけのSilverを選んで申し込みテストカードで支払うと、決済後のランディングから自分の広告一覧へ進めて「掲載中」と出て、掲載開始通知が届く', async ({
    page,
  }) => {
    test.setTimeout(CHECKOUT_FLOW_TIMEOUT_MS + PRODUCT_FLOW_TIMEOUT_MS);
    test.skip(
      isNearSponsorshipNoticeTiming(new Date()),
      SPONSORSHIP_TIMING_SKIP_REASON,
    );
    const { account, product } = await registerSponsorshipOwner(page);
    await kickOffProduct(product.handle);
    const today = businessDateOf(new Date());

    await page.goto(SPONSORSHIP_APPLY_HREF);
    const form = await waitForSponsorshipApplicationForm(page);
    await chooseSponsorshipProductAndTier(page, form, product.name, 'silver');
    await chooseSponsorshipDate(form, 'start', today);
    await chooseSponsorshipDate(form, 'end', today);
    const startedAt = new Date();
    const start = await startSponsorshipCheckout(page, form);
    test.skip(
      start.kind === 'payments_unavailable',
      SPONSORSHIP_CHECKOUT_SKIP_REASON,
    );

    await preparePaymentWithTestCard(page);
    await confirmPayment(page);
    await openMySponsorshipsFromReturn(page);
    await expectActiveInMySponsorships(page, product.name);
    const mail = await expectSponsorshipStartNotice(
      account,
      product.name,
      startedAt,
    );
    expect(mail.text).toContain(SPONSORSHIP_TIER_LABELS.silver);
  });
});
