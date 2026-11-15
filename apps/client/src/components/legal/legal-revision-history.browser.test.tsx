import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  type LegalRevisionSummary,
  LegalRevisionHistory,
} from './legal-revision-history.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const FIRST: LegalRevisionSummary = {
  versionNumber: 1,
  publishedAt: '2026-03-31T15:30:00.000Z',
  changeSummary: '初版を公開しました。',
};
const SECOND: LegalRevisionSummary = {
  versionNumber: 2,
  publishedAt: '2026-07-01T01:00:00.000Z',
  changeSummary: '第5条の禁止事項に迷惑行為を加えました。',
};
const THIRD: LegalRevisionSummary = {
  versionNumber: 3,
  publishedAt: '2026-10-23T03:00:00.000Z',
  changeSummary: '問い合わせ先を改めました。',
};

const history = () => page.getByRole('region', { name: '改訂履歴' });
const items = () => history().getByRole('list').getByRole('listitem');

async function renderHistory(
  revisions: readonly LegalRevisionSummary[],
  kind: LegalDocumentKind = 'terms',
) {
  return renderInRouter(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <LegalRevisionHistory kind={kind} revisions={revisions} />
    </DisplayPreferencesProvider>,
  );
}

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('LegalRevisionHistory', () => {
  test('見出し「改訂履歴」の番号付きの一覧に、受け取った順によらず新しい版から並べる', async () => {
    await renderHistory([FIRST, THIRD, SECOND]);

    await expect
      .element(history().getByRole('heading', { level: 2 }))
      .toHaveTextContent('改訂履歴');
    expect(history().getByRole('list').element().tagName.toLowerCase()).toBe(
      'ol',
    );
    expect(
      items()
        .elements()
        .map((item) => item.querySelector('a')?.textContent),
    ).toStrictEqual(['第3版', '第2版', '第1版']);
  });

  test('各版に、その版のページへのリンク・曜日を含まない年月日の公開日・変更概要を示す', async () => {
    await renderHistory([THIRD, SECOND, FIRST]);

    const first = items().nth(2);
    await expect
      .element(first.getByRole('link', { name: '第1版', exact: true }))
      .toHaveAttribute('href', '/terms/revisions/1');
    const time = first.element().querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-03-31T15:30:00.000Z');
    expect(time?.textContent).toBe('2026年4月1日');
    await expect.element(first).toHaveTextContent('初版を公開しました。');

    const latest = items().nth(0);
    await expect
      .element(latest.getByRole('link', { name: '第3版', exact: true }))
      .toHaveAttribute('href', '/terms/revisions/3');
    expect(latest.element().querySelector('time')?.textContent).toBe(
      '2026年10月23日',
    );
    await expect
      .element(latest)
      .toHaveTextContent('問い合わせ先を改めました。');
  });

  test.each([
    ['privacy', '/privacy/revisions/2'],
    ['legal-notice', '/legal/revisions/2'],
  ] as const)(
    '種類が%sの版へのリンクは、その文書の過去版のパスにする',
    async (kind, href) => {
      await renderHistory([SECOND], kind);

      await expect
        .element(history().getByRole('link', { name: '第2版', exact: true }))
        .toHaveAttribute('href', href);
    },
  );

  test('版のリンクを選ぶと、ページを読み込み直さずにその版のページへ遷移する', async () => {
    const router = await renderHistory([THIRD, SECOND, FIRST]);

    await userEvent.click(
      history().getByRole('link', { name: '第2版', exact: true }),
    );

    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/terms/revisions/2');
  });

  test('版を公開した管理者の情報を受け取った値に含んでいても表示しない', async () => {
    const revisionWithEditor = {
      ...THIRD,
      publishedBy: { id: '01J0ADMIN0000000000000000A', nickname: '運営の山田' },
    };

    await renderHistory([revisionWithEditor, SECOND]);

    await expect.element(items().nth(0)).toHaveTextContent('第3版');
    expect(history().element().textContent).not.toContain('運営の山田');
    expect(history().element().textContent).not.toContain('01J0ADMIN');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      await renderHistory([THIRD, SECOND, FIRST]);
      await expect.element(history()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
