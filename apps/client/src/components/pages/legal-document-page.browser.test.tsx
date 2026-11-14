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
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { LegalRevisionSummary } from '../legal/legal-revision-history.tsx';
import {
  type LegalDocumentPageState,
  type LegalDocumentView,
  LegalDocumentPage,
} from './legal-document-page.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const LATEST_PUBLISHED_AT = '2026-10-23T03:00:00.000Z';

const BODY = [
  '## 第1条(目的)',
  '',
  '本規約は[外部の案内](https://other.example/guide)と[ヘルプ](https://client.example/help)を参照します。',
].join('\n');

const LATEST_REVISION: LegalRevisionSummary = {
  versionNumber: 2,
  publishedAt: LATEST_PUBLISHED_AT,
  changeSummary: '第5条の禁止事項に迷惑行為を加えました。',
};

const REVISIONS: readonly LegalRevisionSummary[] = [
  LATEST_REVISION,
  {
    versionNumber: 1,
    publishedAt: '2026-03-31T15:30:00.000Z',
    changeSummary: '初版を公開しました。',
  },
];

const PUBLISHED: LegalDocumentView = {
  latest: { versionNumber: 2, publishedAt: LATEST_PUBLISHED_AT, body: BODY },
  revisions: REVISIONS,
};

const PREPARING: LegalDocumentView = { latest: null, revisions: [] };

const success = (document: LegalDocumentView): LegalDocumentPageState => ({
  status: 'success',
  document,
});

const main = () => page.getByRole('main');
const heading = () => page.getByRole('heading', { level: 1 });
const history = () => page.getByRole('region', { name: '改訂履歴' });
const markdownBody = () =>
  document.querySelector('[data-slot="markdown-content"]');
const lastRevised = () =>
  page.getByRole('definition').filter({ has: page.getByRole('time') });

async function renderPage(
  state: LegalDocumentPageState,
  kind: 'terms' | 'privacy' | 'legal-notice' = 'terms',
) {
  return renderInRouter(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <main>
        <LegalDocumentPage kind={kind} state={state} />
      </main>
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

describe('LegalDocumentPage', () => {
  test.each([
    ['terms', '利用規約'],
    ['privacy', 'プライバシーポリシー'],
    ['legal-notice', '法的通知'],
  ] as const)('種類が%sの文書は「%s」を見出しにする', async (kind, name) => {
    await renderPage(success(PUBLISHED), kind);

    await expect.element(heading()).toHaveTextContent(name);
  });

  test('最新版の公開日時を「最終改訂日」として曜日を含まない年月日で機械可読な日時とともに示す', async () => {
    await renderPage(success(PUBLISHED));

    await expect
      .element(main().getByRole('term'))
      .toHaveTextContent('最終改訂日');
    const time = lastRevised().element().querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(LATEST_PUBLISHED_AT);
    expect(time?.textContent).toBe('2026年10月23日');
  });

  test('本文をマークダウンとして描画し、外部リンクを別タブで開きnoopenerを付ける', async () => {
    await renderPage(success(PUBLISHED));

    await expect
      .element(main().getByRole('heading', { level: 2, name: '第1条(目的)' }))
      .toBeVisible();
    const external = main().getByRole('link', { name: '外部の案内' });
    await expect.element(external).toHaveAttribute('rel', 'noopener');
    await expect.element(external).toHaveAttribute('target', '_blank');
    const sameSite = main().getByRole('link', { name: 'ヘルプ' });
    await expect.element(sameSite).not.toHaveAttribute('target');
  });

  test('本文の後に改訂履歴を新しい順に置き、各版のページへリンクする', async () => {
    await renderPage(success(PUBLISHED));

    await expect.element(history()).toBeVisible();
    const body = markdownBody();
    expect(body).not.toBeNull();
    expect(
      body?.compareDocumentPosition(history().element()) ??
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      history()
        .getByRole('link')
        .elements()
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toStrictEqual([
      ['第2版', '/terms/revisions/2'],
      ['第1版', '/terms/revisions/1'],
    ]);
  });

  test('改訂履歴に版を公開した管理者の情報を出さない', async () => {
    const revisionWithEditor = {
      ...LATEST_REVISION,
      publishedBy: { id: '01J0ADMIN0000000000000000A', nickname: '運営の山田' },
    };

    await renderPage(
      success({ ...PUBLISHED, revisions: [revisionWithEditor] }),
    );

    await expect.element(history()).toBeVisible();
    expect(main().element().textContent).not.toContain('運営の山田');
    expect(main().element().textContent).not.toContain('01J0ADMIN');
  });

  test('版が無い文書は、見出しの下に準備中である旨だけを示し、本文・最終改訂日・改訂履歴を描かない', async () => {
    await renderPage(success(PREPARING));

    await expect.element(heading()).toHaveTextContent('利用規約');
    await expect
      .element(main().getByText('この文書は準備中です。'))
      .toBeVisible();
    expect(markdownBody()).toBeNull();
    expect(history().query()).toBeNull();
    expect(main().element().textContent).not.toContain('最終改訂日');
    expect(main().element().querySelector('time')).toBeNull();
  });

  test('読み込み中は見出しの下に読み込み中の状態を示し、本文と改訂履歴を描かない', async () => {
    await renderPage({ status: 'pending' });

    await expect.element(heading()).toHaveTextContent('利用規約');
    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(markdownBody()).toBeNull();
    expect(history().query()).toBeNull();
    expect(main().getByRole('alert').query()).toBeNull();
  });

  test('取得の失敗はAPIサーバーの文言を再試行の操作とともに示し、再試行で見出しへフォーカスを移す', async () => {
    const onRetry = vi.fn();
    await renderPage({
      status: 'error',
      error: new GraphQLClientError({
        code: 'upstream_unavailable',
        message: '現在ご利用いただけません。時間をおいて再度お試しください。',
        status: 503,
      }),
      onRetry,
    });

    await expect.element(heading()).toHaveTextContent('利用規約');
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(
        '現在ご利用いただけません。時間をおいて再度お試しください。',
      );
    expect(main().getByRole('status').query()).toBeNull();
    expect(markdownBody()).toBeNull();

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    await expect.element(heading()).toHaveFocus();
  });

  test('想定外の例外では例外の文言を出さず、想定外の失敗の文言と問い合わせの導線を示す', async () => {
    await renderPage({
      status: 'error',
      error: new TypeError('Failed to fetch'),
      onRetry: vi.fn(),
    });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
    expect(main().element().textContent).not.toContain('Failed to fetch');
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      ['公開済み', success(PUBLISHED)],
      ['準備中', success(PREPARING)],
      ['読み込み中', { status: 'pending' } as const],
      [
        '取得の失敗',
        {
          status: 'error',
          error: new TypeError('Failed to fetch'),
          onRetry: () => undefined,
        } as const,
      ],
    ] satisfies readonly (readonly [string, LegalDocumentPageState])[])(
      '%sの表示でアクセシビリティの検査の違反が0件',
      async (_label, state) => {
        await renderPage(state);
        await expect.element(heading()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
