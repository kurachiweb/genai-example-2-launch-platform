import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import {
  COMMENT_REPORT_TARGET,
  DETACHED_REPORT_TARGET,
  PRODUCT_REPORT_TARGET,
  UNAVAILABLE_REPORT_TARGET,
  USER_REPORT_TARGET,
} from '../../../../test/reporting-fixtures.ts';
import { ReportTargetCell } from './report-target-cell.tsx';

// テストの補助が読み込む照会の設定は同型の関数を読み込み、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

afterEach(() => {
  applyColorScheme('light');
});

describe('ReportTargetCell', () => {
  test('ユーザーは種類とニックネームとハンドルを示す', async () => {
    await render(<ReportTargetCell target={USER_REPORT_TARGET} />);

    await expect
      .element(page.getByText('ユーザー', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText('サンプル太郎(@maker_ai)', { exact: true }))
      .toBeVisible();
  });

  test('プロダクトは種類と名称とハンドルを示す', async () => {
    await render(<ReportTargetCell target={PRODUCT_REPORT_TARGET} />);

    await expect
      .element(page.getByText('プロダクト', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText('Pitch Notes(pitch-notes)', { exact: true }))
      .toBeVisible();
  });

  test('コメントは本文の抜粋をマークダウンやHTMLとして解釈せず改行を保った文字列で示し、プロダクトへのコメントであることを示す', async () => {
    const { container } = await render(
      <ReportTargetCell target={COMMENT_REPORT_TARGET} />,
    );

    await expect
      .element(page.getByText('Pitch Notesへのコメント', { exact: true }))
      .toBeVisible();
    const excerpt = page.getByText(/強調/u);
    await expect
      .element(excerpt)
      .toHaveTextContent('**強調**のつもりの<b>文字列</b> 2行目');
    expect(excerpt.element().textContent).toBe(
      '**強調**のつもりの<b>文字列</b>\n2行目',
    );
    await expect.element(excerpt).toHaveClass('whitespace-pre-wrap');
    expect(container.querySelector('b, strong')).toBeNull();
  });

  test('読めない対象は種類と「表示できない対象」を示す', async () => {
    await render(<ReportTargetCell target={UNAVAILABLE_REPORT_TARGET} />);

    await expect
      .element(page.getByText('プロダクト', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText('表示できない対象', { exact: true }))
      .toBeVisible();
  });

  test('対象への参照を消した案件は種類と「削除された対象」を示す', async () => {
    await render(<ReportTargetCell target={DETACHED_REPORT_TARGET} />);

    await expect
      .element(page.getByText('コメント', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText('削除された対象', { exact: true }))
      .toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('対象の表示のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <main className="bg-background p-4">
        <ReportTargetCell target={COMMENT_REPORT_TARGET} />
        <ReportTargetCell target={DETACHED_REPORT_TARGET} />
      </main>,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
