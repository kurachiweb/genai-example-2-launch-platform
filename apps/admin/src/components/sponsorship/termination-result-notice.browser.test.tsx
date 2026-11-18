import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  PAUSED_ROW,
  terminationResultOf,
} from '../../../test/admin-sponsorships-fixtures.ts';
import type { AdminSponsorshipTerminationResult } from '../../graphql/admin-sponsorships.ts';
import { TerminationResultNotice } from './termination-result-notice.tsx';

// テストの値が読み込むGraphQLの実行の入口は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOKYO: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

const PURCHASE_ID = PAUSED_ROW.purchaseId ?? '';

const REQUESTED_MESSAGE = '自動の返金を依頼しました。';

const ALREADY_REFUNDED_MESSAGE =
  '返金できる残りが無いため、自動の返金を依頼しませんでした。Stripeのダッシュボードで返金の状況を確かめてください。';

const REJECTED_MESSAGE =
  '自動の返金を依頼できませんでした。Stripeのダッシュボードで対応してください。';

const COPIED = '購入IDをコピーしました。';

const COPY_FAILED = '購入IDをコピーできませんでした。';

const renderNotice = async (result: AdminSponsorshipTerminationResult) => {
  await render(<Toaster />);
  await render(
    <DisplayPreferencesProvider initial={TOKYO}>
      <main className="bg-background p-4 text-foreground">
        <TerminationResultNotice result={result} />
      </main>
    </DisplayPreferencesProvider>,
  );
};

const region = () =>
  page.getByRole('region', { name: `申込${PAUSED_ROW.id}の強制終了の結果` });

// 項目名ごとに、値の要素の文字を並べる
const itemsOf = (): readonly (readonly [string, string])[] =>
  [...region().element().querySelectorAll(':scope dl > div')]
    .filter((group) => group.parentElement?.closest('dd') === null)
    .map((group) => [
      group.querySelector('dt')?.textContent ?? '',
      group.querySelector('dd')?.textContent ?? '',
    ]);

const refundOf = (label: string) => {
  const group = [
    ...region().element().querySelectorAll(':scope dl > div'),
  ].find((element) => element.querySelector('dt')?.textContent === label);
  if (group === undefined) {
    throw new Error(`項目がありません: ${label}`);
  }
  return page.elementLocator(group.querySelector('dd') ?? group);
};

const copyButton = () =>
  region().getByRole('button', { name: '購入IDをコピー', exact: true });

const stubClipboardWrite = (implementation: (text: string) => Promise<void>) =>
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(implementation);

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO);
});

afterEach(async () => {
  vi.restoreAllMocks();
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('TerminationResultNotice', () => {
  test('対象の申込IDを含む見出しの区画に、強制終了日・未掲載日数・返金目安額・表示停止の返金額と購入IDを示す', async () => {
    await renderNotice(terminationResultOf());

    await expect
      .element(region().getByRole('heading', { level: 2 }))
      .toHaveTextContent(`申込${PAUSED_ROW.id}の強制終了の結果`);
    expect(itemsOf().map(([label]) => label)).toStrictEqual([
      '強制終了日',
      '未掲載日数',
      '返金目安額',
      '表示停止の返金額',
      '購入ID',
    ]);
    expect(itemsOf()[0]).toStrictEqual(['強制終了日', '2026年11月26日(木)']);
    expect(itemsOf()[1]).toStrictEqual(['未掲載日数', '5日']);
    await expect
      .element(region().getByText('2026年11月26日(木)'))
      .toHaveAttribute('datetime', '2026-11-26');
    await expect
      .element(region().getByText(PURCHASE_ID, { exact: true }))
      .toBeVisible();
  });

  test('依頼した返金には、依頼した返金額と依頼した旨を返金ごとに示す', async () => {
    await renderNotice(terminationResultOf());

    await expect
      .element(refundOf('返金目安額'))
      .toHaveTextContent(`$50.00依頼した返金額$50.00${REQUESTED_MESSAGE}`);
    await expect
      .element(refundOf('表示停止の返金額'))
      .toHaveTextContent(`$30.00依頼した返金額$30.00${REQUESTED_MESSAGE}`);
  });

  test('残りの全額で依頼した返金は、依頼した返金額を「(残りの全額)」で示す', async () => {
    await renderNotice(
      terminationResultOf({
        terminationRefundRequested: null,
        stopRefundStatus: null,
        stopRefundRequested: null,
      }),
    );

    await expect
      .element(refundOf('返金目安額'))
      .toHaveTextContent(
        `$50.00依頼した返金額(残りの全額)${REQUESTED_MESSAGE}`,
      );
  });

  test('返金済みと拒否の返金には、依頼した返金額を示さず、Stripeのダッシュボードで確かめる・対応する案内を示す', async () => {
    await renderNotice(
      terminationResultOf({
        terminationRefundStatus: 'ALREADY_REFUNDED',
        terminationRefundRequested: null,
        stopRefundStatus: 'REJECTED',
        stopRefundRequested: null,
      }),
    );

    await expect
      .element(refundOf('返金目安額'))
      .toHaveTextContent(`$50.00${ALREADY_REFUNDED_MESSAGE}`);
    await expect
      .element(refundOf('表示停止の返金額'))
      .toHaveTextContent(`$30.00${REJECTED_MESSAGE}`);
    expect(region().getByText('依頼した返金額').elements()).toHaveLength(0);
  });

  test('返金額が0・返金不要の返金は結果を示さず、表示停止が無ければ表示停止の返金額を示さない', async () => {
    await renderNotice(
      terminationResultOf({
        unexposedDays: 0,
        refundEstimate: { amount: 0, currency: 'usd' },
        terminationRefundStatus: null,
        terminationRefundRequested: null,
        stoppedDays: 0,
        stopRefundAmount: { amount: 0, currency: 'usd' },
        stopRefundStatus: null,
        stopRefundRequested: null,
      }),
    );

    expect(itemsOf()).toStrictEqual([
      ['強制終了日', '2026年11月26日(木)'],
      ['未掲載日数', '0日'],
      ['返金目安額', '$0.00'],
      ['購入ID', `${PURCHASE_ID}購入IDをコピー`],
    ]);
    for (const message of [
      REQUESTED_MESSAGE,
      ALREADY_REFUNDED_MESSAGE,
      REJECTED_MESSAGE,
    ]) {
      expect(region().getByText(message).elements()).toHaveLength(0);
    }
  });

  test('「購入IDをコピー」で購入IDを写し、成功を通知する', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await renderNotice(terminationResultOf());

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPIED)).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(PURCHASE_ID);
    expect(page.getByText(COPY_FAILED).elements()).toStrictEqual([]);
  });

  test('クリップボードへの書き込みが拒まれた時は失敗を通知する', async () => {
    stubClipboardWrite(() =>
      Promise.reject(new DOMException('拒否', 'NotAllowedError')),
    );
    await renderNotice(terminationResultOf());

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPY_FAILED)).toBeVisible();
    expect(page.getByText(COPIED).elements()).toStrictEqual([]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('返金の結果を全種類示した区画で、アクセシビリティの検査の違反が0件', async () => {
      await renderNotice(
        terminationResultOf({
          terminationRefundStatus: 'ALREADY_REFUNDED',
          terminationRefundRequested: null,
          stopRefundStatus: 'REJECTED',
          stopRefundRequested: null,
        }),
      );
      await expect.element(region()).toBeVisible();
      applyColorScheme(scheme);

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
