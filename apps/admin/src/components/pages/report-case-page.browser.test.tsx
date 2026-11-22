import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { MODERATION_DISPLAY } from '../../../test/moderation-fixtures.ts';
import {
  GUEST_REPORT_WITH_CONTACT,
  GUEST_REPORT_WITHOUT_CONTACT,
  IN_PROGRESS_INFRINGEMENT_DETAIL,
  MEMBER_REPORT,
  REPORT_CASE_PATH,
  type ReportCaseDetailData,
  reportCaseDetailOf,
  renderReportCasePage,
  respondReportCaseGraphQL,
} from '../../../test/report-case-page-fixtures.ts';
import {
  REPORT_COMMENT_ID,
  REPORT_PRODUCT_ID,
  REPORT_USER_ID,
} from '../../../test/reporting-fixtures.ts';
import type { AdminRole } from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CLIENT_ORIGIN = 'https://client.example';

const main = () => page.getByRole('main');
const sectionOf = (name: string) =>
  main().getByRole('region', { name, exact: true });

// 項目名の次の値の要素を返す
const definitionOf = (sectionName: string, term: string): HTMLElement => {
  const terms = Array.from(
    sectionOf(sectionName).element().querySelectorAll('dt'),
  );
  const found = terms.find((element) => element.textContent === term);
  const definition = found?.nextElementSibling;
  if (!(definition instanceof HTMLElement)) {
    throw new Error(`項目「${term}」がありません。`);
  }
  return definition;
};

const renderWith = async (
  detail: ReportCaseDetailData | null,
  role: AdminRole = 'MODERATOR',
) => {
  respondReportCaseGraphQL(executeGraphQL, { role, detail });
  await renderReportCasePage(role);
  await expect.element(main().getByRole('heading', { level: 1 })).toBeVisible();
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

describe('題名と導線', () => {
  test('題名「通報の案件の詳細」と一覧への導線を示す', async () => {
    await renderWith(reportCaseDetailOf());

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('通報の案件の詳細');
    await expect
      .element(main().getByRole('link', { name: '通報の一覧へ' }))
      .toHaveAttribute('href', '/reports');
  });
});

describe('対象', () => {
  test('プロダクトは種類と名称とハンドルを示し、利用者側のページとUGC管理のプロダクトの詳細への導線を置く', async () => {
    await renderWith(reportCaseDetailOf());

    expect(definitionOf('対象', '対象の種類').textContent).toBe('プロダクト');
    await expect
      .element(sectionOf('対象').getByText('Pitch Notes(pitch-notes)'))
      .toBeVisible();
    await expect
      .element(
        sectionOf('対象').getByRole('link', { name: '利用者側のページを開く' }),
      )
      .toHaveAttribute('href', `${CLIENT_ORIGIN}/p/pitch-notes`);
    await expect
      .element(sectionOf('対象').getByRole('link', { name: '管理画面で開く' }))
      .toHaveAttribute('href', `/products/${REPORT_PRODUCT_ID}`);
  });

  test('ユーザーはニックネームとハンドルを示し、利用者側のプロフィールとユーザーの一覧のハンドルの検索への導線を置く', async () => {
    await renderWith(
      reportCaseDetailOf({
        case: {
          target: {
            kind: 'USER',
            id: REPORT_USER_ID,
            detached: false,
            available: true,
            handle: 'maker_ai',
            label: 'サンプル太郎',
            excerpt: null,
            productId: null,
            productName: null,
            productHandle: null,
          },
        },
      }),
    );

    expect(definitionOf('対象', '対象の種類').textContent).toBe('ユーザー');
    await expect
      .element(sectionOf('対象').getByText('サンプル太郎(@maker_ai)'))
      .toBeVisible();
    await expect
      .element(
        sectionOf('対象').getByRole('link', { name: '利用者側のページを開く' }),
      )
      .toHaveAttribute('href', `${CLIENT_ORIGIN}/@maker_ai`);
    await expect
      .element(sectionOf('対象').getByRole('link', { name: '管理画面で開く' }))
      .toHaveAttribute('href', '/users?handle=maker_ai');
  });

  test('コメントは抜粋を文字列として改行を保って示し、対象のプロダクトのページとコメントの一覧のプロダクトのハンドルの絞り込みへの導線を置く', async () => {
    const excerpt = '**強調**のつもりの<b>文字列</b>\n2行目';
    await renderWith(
      reportCaseDetailOf({
        case: {
          target: {
            kind: 'COMMENT',
            id: REPORT_COMMENT_ID,
            detached: false,
            available: true,
            handle: null,
            label: null,
            excerpt,
            productId: REPORT_PRODUCT_ID,
            productName: 'Pitch Notes',
            productHandle: 'pitch-notes',
          },
        },
      }),
    );

    expect(definitionOf('対象', '対象の種類').textContent).toBe('コメント');
    await expect
      .element(sectionOf('対象').getByText('Pitch Notesへのコメント'))
      .toBeVisible();
    const excerptElement = sectionOf('対象')
      .element()
      .querySelector('[data-slot="report-target-excerpt"]');
    expect(excerptElement?.textContent).toBe(excerpt);
    expect(excerptElement?.querySelector('strong, b')).toBeNull();
    await expect
      .element(
        sectionOf('対象').getByRole('link', { name: '利用者側のページを開く' }),
      )
      .toHaveAttribute('href', `${CLIENT_ORIGIN}/p/pitch-notes`);
    await expect
      .element(sectionOf('対象').getByRole('link', { name: '管理画面で開く' }))
      .toHaveAttribute('href', '/comments?productHandle=pitch-notes');
  });

  test.each([
    {
      name: '表示できない対象',
      target: {
        kind: 'PRODUCT' as const,
        id: REPORT_PRODUCT_ID,
        detached: false,
        available: false,
        handle: null,
        label: null,
        excerpt: null,
        productId: null,
        productName: null,
        productHandle: null,
      },
    },
    {
      name: '削除された対象',
      target: {
        kind: 'COMMENT' as const,
        id: null,
        detached: true,
        available: false,
        handle: null,
        label: null,
        excerpt: null,
        productId: null,
        productName: null,
        productHandle: null,
      },
    },
  ])('$nameは文言で示し、導線を置かない', async ({ name, target }) => {
    await renderWith(reportCaseDetailOf({ case: { target } }));

    await expect.element(sectionOf('対象').getByText(name)).toBeVisible();
    await expect
      .element(sectionOf('対象').getByRole('link'))
      .not.toBeInTheDocument();
  });
});

describe('対応の状況', () => {
  test('状態と最後に変わった日時、件数とカテゴリごとの件数、最初と最後の受付日時、権利侵害の対応期間を日時の要素で示す', async () => {
    await renderWith(reportCaseDetailOf());

    expect(definitionOf('対応の状況', '対応ステータス').textContent).toBe(
      '未対応',
    );
    expect(
      definitionOf('対応の状況', '最後に変わった日時')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe('2026-11-02T04:00:00.000Z');
    expect(definitionOf('対応の状況', '通報の件数').textContent).toBe('3件');
    expect(
      Array.from(
        definitionOf('対応の状況', 'カテゴリごとの件数').querySelectorAll('li'),
        (item) => item.textContent,
      ),
    ).toStrictEqual(['権利侵害 2件', 'その他 1件']);
    expect(
      definitionOf('対応の状況', '最初の受付日時')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe('2026-11-01T00:00:00.000Z');
    expect(
      definitionOf('対応の状況', '最後の受付日時')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe('2026-11-02T03:00:00.000Z');
    expect(definitionOf('対応の状況', '対応期間').textContent).toBe(
      '対応中 4時間',
    );
  });

  test('対応期間の目標の超過を文言で示す', async () => {
    await renderWith(
      reportCaseDetailOf({
        case: {
          responseTime: {
            startedAt: '2026-11-01T00:00:00.000Z',
            completedAt: null,
            elapsedSeconds: 10 * 24 * 60 * 60,
            alerts: ['START_OVERDUE', 'DECISION_OVERDUE'],
          },
        },
      }),
    );

    const responseTime = definitionOf('対応の状況', '対応期間');
    expect(responseTime.textContent).toContain('対応中 10日0時間');
    expect(responseTime.textContent).toContain(
      '確認開始の目標(1営業日)を超えています',
    );
    expect(responseTime.textContent).toContain('判断の目標(9日)を超えています');
  });

  test('権利侵害でない案件は対応期間と照会の区画を示さない', async () => {
    await renderWith(
      reportCaseDetailOf({
        case: {
          infringement: false,
          responseTime: null,
          categoryCounts: [
            {
              categoryId: '01JE0000000000000000000002',
              name: 'その他',
              count: 3,
            },
          ],
        },
      }),
    );

    await expect
      .element(sectionOf('対応の状況').getByText('対応期間'))
      .not.toBeInTheDocument();
    await expect.element(sectionOf('権利侵害の照会')).not.toBeInTheDocument();
  });

  test.each([
    {
      name: '措置で対応済にした案件',
      status: 'RESOLVED' as const,
      resolution: 'PRODUCT_HIDE' as const,
      kind: 'プロダクトの非公開化',
    },
    {
      name: '措置なしで対応済にした案件',
      status: 'RESOLVED' as const,
      resolution: 'NONE' as const,
      kind: '措置なし',
    },
    {
      name: '却下した案件',
      status: 'REJECTED' as const,
      resolution: null,
      kind: '却下',
    },
  ])(
    '$nameは完了の種類と理由と日時を示す',
    async ({ status, resolution, kind }) => {
      const closingReason = '**確認**の<b>結果</b>\n2行目';
      await renderWith(
        reportCaseDetailOf({
          case: { status },
          resolution,
          closingReason,
          closedAt: '2026-11-05T01:00:00.000Z',
        }),
      );

      expect(definitionOf('対応の状況', '完了の種類').textContent).toBe(kind);
      const reason = definitionOf('対応の状況', '完了の理由');
      expect(reason.textContent).toBe(closingReason);
      expect(reason.querySelector('strong, b')).toBeNull();
      expect(
        definitionOf('対応の状況', '完了の日時')
          .querySelector('time')
          ?.getAttribute('datetime'),
      ).toBe('2026-11-05T01:00:00.000Z');
    },
  );

  test('未完了の案件は完了の種類と理由と日時を示さない', async () => {
    await renderWith(reportCaseDetailOf());

    await expect
      .element(sectionOf('対応の状況').getByText('完了の種類'))
      .not.toBeInTheDocument();
    await expect
      .element(sectionOf('対応の状況').getByText('完了の日時'))
      .not.toBeInTheDocument();
  });
});

describe('権利侵害の照会の区画', () => {
  test('照会を送っていなければその旨を示す', async () => {
    await renderWith(IN_PROGRESS_INFRINGEMENT_DETAIL);

    await expect
      .element(
        sectionOf('権利侵害の照会').getByText('照会はまだ送っていません。'),
      )
      .toBeVisible();
  });

  test('最後の照会の日時と内容を文字列で、回答の期限を日時の要素で示す', async () => {
    const message = '**権利**の<b>確認</b>\n2行目';
    await renderWith(
      reportCaseDetailOf({
        case: { status: 'IN_PROGRESS' },
        lastInquiry: {
          sentAt: '2026-11-03T00:00:00.000Z',
          message,
          deadline: '2026-11-10T00:00:00.000Z',
          overdue: false,
        },
      }),
    );

    expect(
      definitionOf('権利侵害の照会', '最後の照会')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe('2026-11-03T00:00:00.000Z');
    const content = definitionOf('権利侵害の照会', '照会の内容');
    expect(content.textContent).toBe(message);
    expect(content.querySelector('strong, b')).toBeNull();
    const deadline = definitionOf('権利侵害の照会', '回答の期限');
    expect(deadline.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-11-10T00:00:00.000Z',
    );
    expect(deadline.textContent).not.toContain('回答の期限を過ぎています');
  });

  test('回答の期限を過ぎていれば色だけに頼らず文言で示す', async () => {
    await renderWith(
      reportCaseDetailOf({
        case: { status: 'IN_PROGRESS' },
        lastInquiry: {
          sentAt: '2026-11-03T00:00:00.000Z',
          message: '確認をお願いします',
          deadline: '2026-11-10T00:00:00.000Z',
          overdue: true,
        },
      }),
    );

    expect(definitionOf('権利侵害の照会', '回答の期限').textContent).toContain(
      '回答の期限を過ぎています',
    );
  });
});

describe('通報の一覧', () => {
  test('通報を受付日時の古い順に、カテゴリ・理由の文字列・受付日時・通報者とともに示し、未ログインは連絡先の有無だけを示す', async () => {
    await renderWith(reportCaseDetailOf());

    const list = sectionOf('通報').getByRole('list', { name: '通報の一覧' });
    const items = Array.from(
      list.element().querySelectorAll<HTMLElement>(':scope > li'),
    );
    expect(items).toHaveLength(3);
    const [member, guestWithContact, guestWithoutContact] = items;
    expect(member?.textContent).toContain('権利侵害');
    expect(member?.textContent).toContain(MEMBER_REPORT.reason);
    expect(member?.textContent).toContain('通報花子(@hanako)');
    expect(member?.querySelector('strong, b')).toBeNull();
    expect(member?.querySelector('time')?.getAttribute('datetime')).toBe(
      MEMBER_REPORT.reportedAt,
    );
    expect(guestWithContact?.textContent).toContain(
      GUEST_REPORT_WITH_CONTACT.reason,
    );
    expect(guestWithContact?.textContent).toContain('未ログイン');
    expect(guestWithContact?.textContent).toContain('連絡先あり');
    expect(guestWithoutContact?.textContent).toContain(
      GUEST_REPORT_WITHOUT_CONTACT.reason,
    );
    expect(guestWithoutContact?.textContent).toContain('連絡先なし');
    expect(main().element().textContent).not.toContain('@example');
  });

  test('ニックネームを読めないログイン中の通報者は表示できない利用者と示す', async () => {
    await renderWith(
      reportCaseDetailOf({
        reports: [
          {
            ...MEMBER_REPORT,
            reporter: {
              kind: 'member',
              nickname: null,
              handle: null,
              hasContact: false,
            },
          },
        ],
      }),
    );

    await expect
      .element(sectionOf('通報').getByText('表示できない利用者'))
      .toBeVisible();
  });
});

describe('ロールによる出し分け', () => {
  test('閲覧のみの管理者には操作の区画と照会の操作を置かない', async () => {
    await renderWith(IN_PROGRESS_INFRINGEMENT_DETAIL, 'VIEWER');

    await expect.element(sectionOf('対象')).toBeVisible();
    await expect.element(sectionOf('操作')).not.toBeInTheDocument();
    await expect
      .element(main().getByRole('button', { name: '照会を送る' }))
      .not.toBeInTheDocument();
  });
});

describe('案件が見つからない時', () => {
  test('存在しない案件では見つからない旨と一覧への導線を示す', async () => {
    respondReportCaseGraphQL(executeGraphQL, {
      role: 'MODERATOR',
      detail: null,
    });
    await renderReportCasePage('MODERATOR', REPORT_CASE_PATH);

    await expect
      .element(
        main().getByRole('region', { name: '通報の案件が見つかりません。' }),
      )
      .toBeVisible();
    await expect
      .element(main().getByRole('link', { name: '通報の一覧へ' }))
      .toHaveAttribute('href', '/reports');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('完了した案件の詳細のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith(
      reportCaseDetailOf({
        case: { status: 'REJECTED' },
        closingReason: '根拠が無いため',
        closedAt: '2026-11-05T01:00:00.000Z',
        lastInquiry: {
          sentAt: '2026-11-03T00:00:00.000Z',
          message: '確認をお願いします',
          deadline: '2026-11-10T00:00:00.000Z',
          overdue: true,
        },
      }),
    );

    expect(await runAxe(main().element())).toStrictEqual([]);
  });

  test('対応中の権利侵害の案件の詳細のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith(IN_PROGRESS_INFRINGEMENT_DETAIL);

    expect(await runAxe(main().element())).toStrictEqual([]);
  });

  test('見つからない表示のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respondReportCaseGraphQL(executeGraphQL, {
      role: 'MODERATOR',
      detail: null,
    });
    await renderReportCasePage('MODERATOR');
    await expect
      .element(
        main().getByRole('region', { name: '通報の案件が見つかりません。' }),
      )
      .toBeVisible();

    expect(await runAxe(main().element())).toStrictEqual([]);
  });
});
