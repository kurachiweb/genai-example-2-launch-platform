import type { Page } from '@playwright/test';

import {
  HELP_TOP_ERROR_MESSAGE,
  HELP_TOP_TITLE,
} from '../../../apps/client/src/components/help/help-messages.ts';
import { TOP_PAGE_ERROR_MESSAGE } from '../../../apps/client/src/components/top/top-page-messages.ts';
import { ULTRAS_PRICE_UNAVAILABLE_MESSAGE } from '../../../apps/client/src/components/ultras/ultras-messages.ts';
import { createListedProducts } from '../../support/directory-fixtures.ts';
import { annotateSkippedCheck } from '../../support/system-status-page.ts';
import { expect, test } from '../auth/auth-test.ts';
import {
  directoryListOf,
  directoryPeriodPath,
  openDirectory,
  productPagePath,
  readDirectoryItemNames,
} from '../directory-steps.ts';
import { profilePath } from '../profile-steps.ts';
import {
  pricingHeading,
  readUltrasPromotionFlag,
  setUltrasPromotionFlag,
  ultrasPricingSection,
  ultrasSubscribeButton,
} from '../ultras-steps.ts';
import { resolveDegradedReads } from './degraded-reads-plan.ts';

const OK_STATUS = 200;

const FLOW_TIMEOUT_MS = 240_000;

test.describe.configure({ timeout: FLOW_TIMEOUT_MS });

async function openReadable(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `${path}の応答の状態コード`).toBe(OK_STATUS);
  await expect(page.getByRole('main')).toBeVisible();
}

// 掲載中のプロダクトと投稿者はローカルのD1へ直接作り、乱数の接尾辞で前回の実行と分ける。メール受信箱を使わないためメール送信を止めた起動でも動くが、ローカルのD1とapi・eventの差し替えを前提とするため、@smokeタグを付けない
test.describe(
  '外部サービスを止めた起動での読み取り(利用者側)',
  { tag: '@degraded' },
  () => {
    test('止めたサービスの一覧の環境変数が設定された起動で、プロダクトの閲覧・プロフィール・ディレクトリ・トップ・ヘルプが成功し、Stripeを止めていれば決済の導線が縮退の案内を示す', async ({
      page,
    }) => {
      const plan = resolveDegradedReads(process.env);
      if (plan.kind === 'skip') {
        annotateSkippedCheck(plan.reason);
        return;
      }
      test.info().annotations.push({
        type: '止めたサービス',
        description: plan.services.join(','),
      });
      const listed = await createListedProducts();
      const [product] = listed.products;
      if (product === undefined) {
        throw new Error('掲載中のプロダクトが作られていません');
      }

      await openReadable(page, productPagePath(product.handle));
      await expect(
        page.getByRole('heading', { level: 1, name: product.name }),
      ).toBeVisible();

      await openReadable(page, profilePath(listed.ownerHandle));
      await expect(
        page.getByRole('main').getByText(`@${listed.ownerHandle}`),
      ).toBeVisible();

      await openDirectory(
        page,
        directoryPeriodPath({ from: listed.matchDate, to: listed.matchDate }),
      );
      await expect(
        directoryListOf(page).getByRole('article').first(),
      ).toBeVisible();
      const listedNames = new Set(listed.products.map(({ name }) => name));
      expect(
        (await readDirectoryItemNames(page)).filter((name) =>
          listedNames.has(name),
        ),
        '掲載中のプロダクトの一覧',
      ).not.toEqual([]);

      await openReadable(page, '/');
      await expect(
        page.getByText(TOP_PAGE_ERROR_MESSAGE, { exact: true }),
        'トップページの読み込みの失敗の表示',
      ).toHaveCount(0);

      await openReadable(page, '/help');
      await expect(
        page.getByRole('heading', { level: 1, name: HELP_TOP_TITLE }),
      ).toBeVisible();
      await expect(
        page.getByText(HELP_TOP_ERROR_MESSAGE, { exact: true }),
        'ヘルプの読み込みの失敗の表示',
      ).toHaveCount(0);

      if (!plan.paymentsStopped) {
        annotateSkippedCheck(
          'Stripeを止めていないため、決済の導線の縮退の案内を確かめない',
        );
        return;
      }
      const promotionWasOn = await readUltrasPromotionFlag();
      await setUltrasPromotionFlag(true);
      try {
        await openReadable(page, '/pricing');
        await expect(pricingHeading(page)).toBeVisible();
        await expect(
          ultrasPricingSection(page).getByText(
            ULTRAS_PRICE_UNAVAILABLE_MESSAGE,
            {
              exact: true,
            },
          ),
          '価格を照会できない旨の案内',
        ).toBeVisible();
        await expect(
          ultrasSubscribeButton(page),
          '価格が無いときの加入のボタン',
        ).toBeDisabled();
      } finally {
        await setUltrasPromotionFlag(promotionWasOn);
      }
    });
  },
);
