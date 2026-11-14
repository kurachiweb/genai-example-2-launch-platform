import { useId } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { AdminSettingsSection } from '../../composition/admin-settings-sections.ts';
import { AdminSettingsSectionsView } from './admin-settings-sections-view.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

const FINAL_DATE_TITLE = 'Yearトーナメントの決勝実施日';

const FINAL_DATE_BODY = '2027年3月31日';

const BROKEN_TITLE = 'Ultras導線の機能フラグ';

const BROKEN_BODY = 'オン';

const SENDER_TITLE = '通知メールの送信者情報';

const SENDER_BODY = 'noreply@mail.example';

// 登録する区画の部品は自分でデータを取得して自分の見出しを描くため、偽の区画も見出し付きの領域を描く
const sectionComponentOf = (title: string, body: string) =>
  function FakeSection() {
    const headingId = useId();
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} tabIndex={-1}>
          {title}
        </h2>
        <p>{body}</p>
      </section>
    );
  };

const FinalDateSection = sectionComponentOf(FINAL_DATE_TITLE, FINAL_DATE_BODY);

const SenderSection = sectionComponentOf(SENDER_TITLE, SENDER_BODY);

const RecoveredSection = sectionComponentOf(BROKEN_TITLE, BROKEN_BODY);

let sectionFailing = false;

// Reactは失敗した描画をやり直すため、テストが失敗を止めるまで描画のたびに失敗する
function ThrowingSection() {
  if (sectionFailing) {
    throw new Error('区画の描画の失敗');
  }
  return <RecoveredSection />;
}

function ThrowingGraphQLSection(): never {
  throw new GraphQLClientError({
    code: 'upstream_unavailable',
    message: '現在ご利用いただけません。時間をおいて再度お試しください。',
    status: 503,
  });
}

const sectionOf = (
  id: string,
  order: number,
  title: string,
  component: AdminSettingsSection['component'],
): AdminSettingsSection => ({ id, order, title, component });

const renderSections = (sections: readonly AdminSettingsSection[]) =>
  renderInRouter(
    <main className="p-4">
      <h1>設定</h1>
      <AdminSettingsSectionsView sections={sections} />
    </main>,
  );

const sectionHeadings = () =>
  page
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent);

const bodyOf = (title: string, body: string) =>
  page.getByRole('region', { name: title }).getByText(body, { exact: true });

beforeEach(() => {
  sectionFailing = false;
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('AdminSettingsSectionsView', () => {
  test('登録の順によらず区画をorderの順に、題を見出しにして並べる', async () => {
    await renderSections([
      sectionOf('notifications.sender-info', 30, SENDER_TITLE, SenderSection),
      sectionOf(
        'tournament-year.final-date',
        10,
        FINAL_DATE_TITLE,
        FinalDateSection,
      ),
    ]);

    await expect.element(bodyOf(SENDER_TITLE, SENDER_BODY)).toBeVisible();
    expect(sectionHeadings()).toStrictEqual([FINAL_DATE_TITLE, SENDER_TITLE]);
    expect(
      page
        .getByRole('region')
        .elements()
        .map((region) => region.getAttribute('aria-labelledby') !== null),
    ).toStrictEqual([true, true]);
  });

  test('1つの区画の描画の失敗はその位置に題の見出しと問い合わせを促さない文言と再試行で示し、他の区画の表示を続け、エラートラッキングへ送る', async () => {
    sectionFailing = true;
    await renderSections([
      sectionOf('a.final-date', 10, FINAL_DATE_TITLE, FinalDateSection),
      sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
      sectionOf('c.sender', 30, SENDER_TITLE, SenderSection),
    ]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect
      .element(
        page.getByRole('region', { name: BROKEN_TITLE }).getByRole('alert'),
      )
      .toBeVisible();
    expect(sectionHeadings()).toStrictEqual([
      FINAL_DATE_TITLE,
      BROKEN_TITLE,
      SENDER_TITLE,
    ]);
    await expect
      .element(bodyOf(FINAL_DATE_TITLE, FINAL_DATE_BODY))
      .toBeVisible();
    await expect.element(bodyOf(SENDER_TITLE, SENDER_BODY)).toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('お問い合わせ');
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.any(Error),
      'render',
    );

    sectionFailing = false;
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(bodyOf(BROKEN_TITLE, BROKEN_BODY)).toBeVisible();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(sectionHeadings()).toStrictEqual([
      FINAL_DATE_TITLE,
      BROKEN_TITLE,
      SENDER_TITLE,
    ]);
  });

  test('再試行で、消えた再試行のボタンから描き直した区画の題の見出しへフォーカスを移す', async () => {
    sectionFailing = true;
    await renderSections([
      sectionOf('a.final-date', 10, FINAL_DATE_TITLE, FinalDateSection),
      sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
    ]);
    await expect.element(page.getByRole('alert')).toBeVisible();
    sectionFailing = false;

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(bodyOf(BROKEN_TITLE, BROKEN_BODY)).toBeVisible();
    await expect
      .element(
        page
          .getByRole('region', { name: BROKEN_TITLE })
          .getByRole('heading', { level: 2, name: BROKEN_TITLE }),
      )
      .toHaveFocus();
  });

  test('再試行でも描画に失敗したときは、その区画の題の見出しへフォーカスを移す', async () => {
    sectionFailing = true;
    await renderSections([
      sectionOf('a.final-date', 10, FINAL_DATE_TITLE, FinalDateSection),
      sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
    ]);
    await expect.element(page.getByRole('alert')).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: BROKEN_TITLE }))
      .toHaveFocus();
  });

  test('GraphQLの失敗はAPIの文言で示し、取得の補助が送るためエラートラッキングへ送り直さない', async () => {
    await renderSections([
      sectionOf('a.graphql', 10, BROKEN_TITLE, ThrowingGraphQLSection),
    ]);

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('現在ご利用いただけません。');
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、区画の並びと失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      sectionFailing = true;
      await renderSections([
        sectionOf('a.final-date', 10, FINAL_DATE_TITLE, FinalDateSection),
        sectionOf('b.broken', 20, BROKEN_TITLE, ThrowingSection),
      ]);
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
