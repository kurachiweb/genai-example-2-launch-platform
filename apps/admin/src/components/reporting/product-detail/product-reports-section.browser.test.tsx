import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../../lib/test/display-emulation.ts';
import {
  callsOf,
  failure,
  success,
} from '../../../../test/admin-accounts-fixtures.ts';
import {
  MODERATION_DISPLAY,
  PRODUCT_ID,
} from '../../../../test/moderation-fixtures.ts';
import {
  productDetailOf,
  renderProductDetailPage,
  respondProductDetailGraphQL,
} from '../../../../test/moderation-product-detail-fixtures.ts';
import { REPORT_CASE_ID } from '../../../../test/reporting-fixtures.ts';
import {
  productReportSummaryOf,
  type ReportSummaryHandler,
  respondReportSummaries,
} from '../../../../test/reporting-summary-fixtures.ts';
import { ADMIN_PRODUCT_DETAIL_SECTIONS } from '../../../composition/admin-product-detail-sections.ts';
import { adminProductReportSummaryQueryOptions } from '../../../graphql/admin-reporting-summaries.ts';
import {
  AdminProductReportSummaryDocument,
  type AdminProductQuery,
  type AdminRole,
} from '../../../graphql/generated/graphql.ts';
import { ProductReportsSection } from './product-reports-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

type ProductDetail = NonNullable<AdminProductQuery['adminProduct']>;

const SECTION_TITLE = '受け付けた通報';

const ALL_ROLES: readonly AdminRole[] = Object.freeze([
  'VIEWER',
  'MODERATOR',
  'SUPER_ADMIN',
]);

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const main = () => page.getByRole('main');
const sectionOf = (name: string) =>
  main().getByRole('region', { name, exact: true });
const reportsSection = () => sectionOf(SECTION_TITLE);
const reportsHeading = () =>
  reportsSection().getByRole('heading', { level: 2, name: SECTION_TITLE });
const caseLink = () =>
  reportsSection().getByRole('link', { name: '案件を開く' });

const summaryCalls = () =>
  callsOf(executeGraphQL, AdminProductReportSummaryDocument);

const renderDetail = async ({
  summary,
  role = 'VIEWER',
  detail,
}: {
  readonly summary: ReportSummaryHandler;
  readonly role?: AdminRole;
  readonly detail?: ProductDetail;
}) => {
  respondProductDetailGraphQL(executeGraphQL, {
    role,
    ...(detail === undefined ? {} : { detail }),
  });
  respondReportSummaries(executeGraphQL, { product: summary });
  const router = await renderProductDetailPage(role);
  await expect.element(main().getByRole('heading', { level: 1 })).toBeVisible();
  return router;
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('プロダクトの詳細の区画の登録', () => {
  test('受け付けた通報の区画を順序10で登録する', () => {
    expect(ADMIN_PRODUCT_DETAIL_SECTIONS).toStrictEqual([
      {
        id: 'content-reporting.product-reports',
        order: 10,
        title: SECTION_TITLE,
        component: ProductReportsSection,
      },
    ]);
    expect(Object.isFrozen(ADMIN_PRODUCT_DETAIL_SECTIONS)).toBe(true);
  });
});

describe('ProductReportsSection', () => {
  test('ローンチ履歴の後に、受け付けた通報の累計を3桁区切りで示し、未完了の案件の対応ステータスと案件の詳細への導線を示す', async () => {
    await renderDetail({
      summary: () =>
        success(
          productReportSummaryOf(12_345, {
            id: REPORT_CASE_ID,
            status: 'IN_PROGRESS',
          }),
        ),
    });

    await expect.element(reportsSection()).toHaveTextContent('12,345件');
    await expect
      .element(reportsSection())
      .toHaveTextContent('未完了の案件対応中');
    await expect
      .element(caseLink())
      .toHaveAttribute('href', `/reports/${REPORT_CASE_ID}`);
    expect(
      [...main().element().querySelectorAll('section > h2')]
        .map((heading) => heading.textContent)
        .slice(-2),
    ).toStrictEqual(['ローンチ履歴', SECTION_TITLE]);
    expect(
      summaryCalls().map(([, variables]: unknown[]) => variables),
    ).toStrictEqual([{ productId: PRODUCT_ID }]);
  });

  test('未完了の案件が無ければ、件数だけを示し、案件の項目と導線を出さない', async () => {
    await renderDetail({ summary: () => success(productReportSummaryOf(3)) });

    await expect.element(reportsSection()).toHaveTextContent('3件');
    expect(reportsSection().element().textContent).not.toContain(
      '未完了の案件',
    );
    expect(caseLink().elements()).toHaveLength(0);
  });

  test('通報が無ければ、受け付けた通報が無い旨を示す', async () => {
    await renderDetail({ summary: () => success(productReportSummaryOf(0)) });

    await expect
      .element(reportsSection())
      .toHaveTextContent('受け付けた通報はありません。');
    expect(reportsSection().element().textContent).not.toContain('0件');
  });

  test('投稿者を読めないプロダクトでも、件数と未完了の案件を示す', async () => {
    await renderDetail({
      detail: productDetailOf({}, { owner: null }),
      summary: () =>
        success(
          productReportSummaryOf(2, { id: REPORT_CASE_ID, status: 'OPEN' }),
        ),
    });

    await expect.element(reportsSection()).toHaveTextContent('2件');
    await expect
      .element(reportsSection())
      .toHaveTextContent('未完了の案件未対応');
    await expect.element(caseLink()).toBeVisible();
  });

  test.each(ALL_ROLES)('%sの管理者にも区画を表示する', async (role) => {
    await renderDetail({
      role,
      summary: () => success(productReportSummaryOf(5)),
    });

    await expect.element(reportsSection()).toHaveTextContent('5件');
  });

  test('取得を待つ間は、区画の題名とともに読み込み中を示す', async () => {
    await renderDetail({ summary: () => new Promise<never>(() => undefined) });

    await expect
      .element(reportsSection().getByRole('status'))
      .toHaveTextContent('読み込み中');
  });

  test('最初の取得の失敗は区画の中だけに問い合わせを促さない文言と再試行で示して詳細の他の表示を止めず、再試行で区画の見出しへフォーカスを移して件数を示す', async () => {
    let available = false;
    await renderDetail({
      summary: () =>
        available
          ? success(productReportSummaryOf(7))
          : failure(INTERNAL_ERROR),
    });

    await expect
      .element(reportsSection().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(main().getByRole('alert').elements()).toHaveLength(1);
    expect(main().element().textContent).not.toContain('お問い合わせ');
    await expect.element(sectionOf('プロダクトの情報')).toBeVisible();
    await expect.element(sectionOf('ローンチ履歴')).toBeVisible();

    available = true;
    await userEvent.click(
      reportsSection().getByRole('button', { name: '再試行' }),
    );

    await expect.element(reportsSection()).toHaveTextContent('7件');
    await expect.element(reportsHeading()).toHaveFocus();
    expect(reportsSection().getByRole('alert').elements()).toHaveLength(0);
  });

  test('取り直しに失敗したときは、表示中の件数と案件を残し、失敗と再試行を示さない', async () => {
    let failing = false;
    const router = await renderDetail({
      summary: () =>
        failing
          ? failure(INTERNAL_ERROR)
          : success(
              productReportSummaryOf(4, {
                id: REPORT_CASE_ID,
                status: 'OPEN',
              }),
            ),
    });
    await expect.element(reportsSection()).toHaveTextContent('4件');
    const { queryClient } = router.options.context;
    const { queryKey } = adminProductReportSummaryQueryOptions(PRODUCT_ID);

    failing = true;
    await queryClient.refetchQueries({ queryKey });

    expect(queryClient.getQueryState(queryKey)?.status).toBe('error');
    await expect.element(reportsSection()).toHaveTextContent('4件');
    await expect.element(caseLink()).toBeVisible();
    expect(main().getByRole('alert').elements()).toHaveLength(0);
    expect(
      reportsSection().getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(0);
    expect(summaryCalls()).toHaveLength(2);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、件数と未完了の案件の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail({
        summary: () =>
          success(
            productReportSummaryOf(9, { id: REPORT_CASE_ID, status: 'OPEN' }),
          ),
      });
      await expect.element(caseLink()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、区画の取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail({ summary: () => failure(INTERNAL_ERROR) });
      await expect.element(reportsSection().getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
