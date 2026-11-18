import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import type { SponsorshipStatus } from '../../graphql/generated/graphql.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { MySponsorshipItem } from './my-sponsorship-item.tsx';
import {
  MY_SPONSORSHIPS_NOW,
  type MySponsorshipNode,
  mySponsorshipOf,
  refundOf,
  SPONSORED_PRODUCT,
} from './my-sponsorships-fixtures.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const PAUSED_NOTICE =
  'プロダクトの公開停止またはアカウントの停止により表示を止めています。掲載期間は延長されず、表示を止めた日数分は掲載の終わりに自動で返金されます。';

const renderItem = (sponsorship: MySponsorshipNode) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <ul aria-label="スポンサー広告">
        <MySponsorshipItem sponsorship={sponsorship} onStale={vi.fn()} />
      </ul>
    </DisplayPreferencesProvider>,
    { cachedViewer: signedInViewerQuery() },
  );

const item = () => page.getByRole('listitem');

const resumeButton = () => item().getByRole('button', { name: '決済へ進む' });

beforeEach(async () => {
  vi.useFakeTimers({ now: MY_SPONSORSHIPS_NOW, toFake: ['Date'] });
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('MySponsorshipItem', () => {
  test('ロゴと詳細へのリンクの名称・ラベルとティア・業務日付の掲載期間と日数・支払った金額・掲載状況を示す', async () => {
    await renderItem(mySponsorshipOf(1));

    await expect
      .element(item().getByRole('link', { name: 'Pitch Notes' }))
      .toHaveAttribute('href', '/p/pitch_notes');
    await expect
      .element(item().getByRole('heading', { level: 2 }))
      .toHaveTextContent('Pitch Notes');
    await expect.element(item()).toHaveTextContent('スポンサーGold');
    await expect
      .element(item())
      .toHaveTextContent('掲載期間11月10日〜11月23日、14日間');
    await expect
      .element(item().getByText('11月10日', { exact: true }))
      .toHaveAttribute('datetime', '2026-11-10');
    await expect
      .element(item().getByText('11月23日', { exact: true }))
      .toHaveAttribute('datetime', '2026-11-23');
    await expect.element(item()).toHaveTextContent('支払った金額$168.00');
    await expect.element(item()).toHaveTextContent('掲載状況掲載中');
  });

  test('今年でない掲載期間には年を付ける', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        status: 'SCHEDULED',
        startsOn: '2026-12-30',
        endsOn: '2027-01-02',
      }),
    );

    await expect
      .element(item())
      .toHaveTextContent('12月30日〜2027年1月2日、4日間');
  });

  test.each<[SponsorshipStatus, string]>([
    ['PENDING_PAYMENT', '未決済'],
    ['SCHEDULED', '掲載予定'],
    ['ACTIVE', '掲載中'],
    ['PAUSED', '表示停止中'],
    ['ENDED', '終了'],
    ['TERMINATED', '強制終了'],
  ])('掲載状況%sを「%s」で示す', async (status, label) => {
    await renderItem(mySponsorshipOf(1, { status }));

    await expect.element(item()).toHaveTextContent(`掲載状況${label}`);
  });

  test('表示停止中は、表示を止めている理由と返金の扱いの注記を示す', async () => {
    await renderItem(mySponsorshipOf(1, { status: 'PAUSED' }));

    await expect.element(item().getByText(PAUSED_NOTICE)).toBeVisible();
  });

  test.each<SponsorshipStatus>([
    'SCHEDULED',
    'ACTIVE',
    'ENDED',
    'TERMINATED',
    'PENDING_PAYMENT',
  ])('%sには表示停止の注記を示さない', async (status) => {
    await renderItem(mySponsorshipOf(1, { status }));

    await expect.element(item()).toBeVisible();
    expect(item().getByText(PAUSED_NOTICE).elements()).toHaveLength(0);
  });

  test('強制終了は、業務日付の強制終了日と理由を示す', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        status: 'TERMINATED',
        terminatedOn: '2026-11-15',
        terminationReason: '広告の内容が規約に反するため',
      }),
    );

    await expect.element(item()).toHaveTextContent('強制終了日11月15日');
    await expect
      .element(item().getByText('11月15日', { exact: true }))
      .toHaveAttribute('datetime', '2026-11-15');
    await expect
      .element(item())
      .toHaveTextContent('理由広告の内容が規約に反するため');
  });

  test('強制終了していなければ、強制終了日と理由の項目を置かない', async () => {
    await renderItem(mySponsorshipOf(1));

    await expect.element(item()).toBeVisible();
    await expect.element(item()).not.toHaveTextContent('強制終了日');
    await expect.element(item()).not.toHaveTextContent('理由');
  });

  test('依頼済みの返金は、強制終了と表示停止のそれぞれの日数と金額を示す', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        status: 'TERMINATED',
        terminatedOn: '2026-11-15',
        terminationReason: '規約違反',
        terminationRefund: refundOf('REQUESTED', 8, 9600),
        displayStopRefund: refundOf('REQUESTED', 2, 2400),
      }),
    );

    await expect
      .element(item().getByText('未掲載の8日分$96.00を返金します'))
      .toBeVisible();
    await expect
      .element(item().getByText('表示を止めた2日分$24.00を返金します'))
      .toBeVisible();
  });

  test('残りの全額で依頼した返金は、金額の位置に「(残りの全額)」を示す', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        status: 'ENDED',
        displayStopRefund: refundOf('REQUESTED', 3, null),
      }),
    );

    await expect
      .element(item().getByText('表示を止めた3日分(残りの全額)を返金します'))
      .toBeVisible();
  });

  test('返金済みの返金は、日数と返金済みである旨を示す', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        status: 'TERMINATED',
        terminatedOn: '2026-11-15',
        terminationReason: '規約違反',
        terminationRefund: refundOf('ALREADY_REFUNDED', 8, null),
        displayStopRefund: refundOf('ALREADY_REFUNDED', 2, null),
      }),
    );

    await expect
      .element(item().getByText('未掲載の8日分は返金済みです'))
      .toBeVisible();
    await expect
      .element(item().getByText('表示を止めた2日分は返金済みです'))
      .toBeVisible();
  });

  test('拒否された返金は、問い合わせの画面へのリンクを含む問い合わせの案内を示す', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        status: 'ENDED',
        displayStopRefund: refundOf('REJECTED', 2, 2400),
      }),
    );

    await expect
      .element(item())
      .toHaveTextContent(
        '返金の手続きでお問い合わせが必要です。お問い合わせください。',
      );
    await expect
      .element(item().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect.element(item()).not.toHaveTextContent('を返金します');
  });

  test('返金が無ければ、返金の表示を置かない', async () => {
    await renderItem(mySponsorshipOf(1, { status: 'ENDED' }));

    await expect.element(item()).toBeVisible();
    await expect.element(item()).not.toHaveTextContent('返金');
  });

  test('論理削除したプロダクトは、名称の代わりに「削除したプロダクト」をリンクにせず示す', async () => {
    await renderItem(mySponsorshipOf(1, { product: null, status: 'ENDED' }));

    await expect
      .element(item().getByRole('heading', { level: 2 }))
      .toHaveTextContent('削除したプロダクト');
    expect(item().getByRole('link').elements()).toHaveLength(0);
    await expect.element(item()).toHaveTextContent('掲載状況終了');
  });

  test('表示できないプロダクトは、名称を詳細へのリンクにしない', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        product: { ...SPONSORED_PRODUCT, listed: false },
        status: 'PAUSED',
      }),
    );

    await expect
      .element(item().getByRole('heading', { level: 2 }))
      .toHaveTextContent('Pitch Notes');
    expect(item().getByRole('link').elements()).toHaveLength(0);
  });

  test('未決済で決済を再開できる申込は、支払った金額を「—」にして「決済へ進む」を置く', async () => {
    await renderItem(
      mySponsorshipOf(1, {
        status: 'PENDING_PAYMENT',
        amountPaid: null,
        startsOn: '2026-11-20',
        endsOn: '2026-11-26',
        canResume: true,
      }),
    );

    await expect.element(item()).toHaveTextContent('支払った金額—');
    await expect.element(resumeButton()).toBeVisible();
  });

  test.each<[string, Partial<MySponsorshipNode>]>([
    [
      '開始日を過ぎた未決済の申込',
      { status: 'PENDING_PAYMENT', amountPaid: null, canResume: false },
    ],
    ['決済済みの広告', { status: 'SCHEDULED', canResume: false }],
  ])('%sには「決済へ進む」を置かない', async (_label, overrides) => {
    await renderItem(mySponsorshipOf(1, overrides));

    await expect.element(item()).toBeVisible();
    expect(resumeButton().elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each<[string, Partial<MySponsorshipNode>]>([
      [
        '強制終了と返金',
        {
          status: 'TERMINATED',
          terminatedOn: '2026-11-15',
          terminationReason: '規約違反',
          terminationRefund: refundOf('REQUESTED', 8, 9600),
          displayStopRefund: refundOf('REJECTED', 2, 2400),
        },
      ],
      ['表示停止中', { status: 'PAUSED' }],
      [
        '決済へ進む',
        { status: 'PENDING_PAYMENT', amountPaid: null, canResume: true },
      ],
      ['削除したプロダクト', { status: 'ENDED', product: null }],
    ])(
      '%sの表示で、アクセシビリティの検査の違反が0件',
      async (_label, overrides) => {
        await renderItem(mySponsorshipOf(1, overrides));
        await expect.element(item()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
