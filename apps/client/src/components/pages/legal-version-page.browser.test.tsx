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
import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  type LegalVersionPageState,
  type LegalVersionView,
  LegalVersionPage,
} from './legal-version-page.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const PUBLISHED_AT = '2026-03-31T15:30:00.000Z';

const BODY = [
  '## 第1条(目的)',
  '',
  '本規約は[外部の案内](https://other.example/guide)と[ヘルプ](https://client.example/help)を参照します。',
].join('\n');

const PAST_VERSION: LegalVersionView = {
  publishedAt: PUBLISHED_AT,
  changeSummary: '初版を公開しました。',
  body: BODY,
  isLatest: false,
};

const LATEST_VERSION: LegalVersionView = { ...PAST_VERSION, isLatest: true };

const success = (version: LegalVersionView): LegalVersionPageState => ({
  status: 'success',
  version,
});

const main = () => page.getByRole('main');
const heading = () => page.getByRole('heading', { level: 1 });
const note = () => page.getByRole('note');
const markdownBody = () =>
  document.querySelector('[data-slot="markdown-content"]');
const definitionOf = (term: string) =>
  main().getByRole('term').filter({ hasText: term }).element()
    .nextElementSibling;

const follows = (earlier: Node, later: Node): boolean =>
  (earlier.compareDocumentPosition(later) &
    Node.DOCUMENT_POSITION_FOLLOWING) !==
  0;

async function renderPage(
  state: LegalVersionPageState,
  {
    kind = 'terms',
    versionNumber = 1,
  }: {
    readonly kind?: LegalDocumentKind;
    readonly versionNumber?: number;
  } = {},
) {
  return renderInRouter(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <main>
        <LegalVersionPage
          kind={kind}
          versionNumber={versionNumber}
          state={state}
        />
      </main>
    </DisplayPreferencesProvider>,
    { path: `/terms/revisions/${String(versionNumber)}` },
  );
}

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('LegalVersionPage', () => {
  test.each([
    ['terms', 1, '利用規約(第1版)'],
    ['privacy', 2, 'プライバシーポリシー(第2版)'],
    ['legal-notice', 12, '法的通知(第12版)'],
  ] as const)(
    '種類が%sの第%i版は「%s」を見出しにする',
    async (kind, versionNumber, name) => {
      await renderPage(success(PAST_VERSION), { kind, versionNumber });

      await expect.element(heading()).toHaveTextContent(name);
    },
  );

  test('版の公開日を曜日を含まない年月日で機械可読な日時とともに示し、変更概要を示す', async () => {
    await renderPage(success(PAST_VERSION));

    await expect.element(heading()).toBeVisible();
    const publishedAt = definitionOf('公開日');
    const time = publishedAt?.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(PUBLISHED_AT);
    expect(time?.textContent).toBe('2026年4月1日');
    expect(definitionOf('変更概要')?.textContent).toBe('初版を公開しました。');
  });

  test('本文をマークダウンとして描画し、外部リンクを別タブで開きnoopenerを付ける', async () => {
    await renderPage(success(PAST_VERSION));

    await expect
      .element(main().getByRole('heading', { level: 2, name: '第1条(目的)' }))
      .toBeVisible();
    const external = main().getByRole('link', { name: '外部の案内' });
    await expect.element(external).toHaveAttribute('rel', 'noopener');
    await expect.element(external).toHaveAttribute('target', '_blank');
    const sameSite = main().getByRole('link', { name: 'ヘルプ' });
    await expect.element(sameSite).not.toHaveAttribute('target');
  });

  test('過去の版では、見出しの後・本文より前に、過去の版である旨と最新版の公開ページへのリンクを示す', async () => {
    await renderPage(success(PAST_VERSION), {
      kind: 'privacy',
      versionNumber: 1,
    });

    await expect
      .element(note())
      .toHaveTextContent('これは第1版です。最新版ではありません。');
    await expect
      .element(note().getByRole('link', { name: '最新版を見る' }))
      .toHaveAttribute('href', '/privacy');
    const body = markdownBody();
    expect(body).not.toBeNull();
    expect(follows(heading().element(), note().element())).toBe(true);
    expect(body !== null && follows(note().element(), body)).toBe(true);
  });

  test('最新版では、本文より前に、最新版である旨と公開ページへのリンクを示す', async () => {
    await renderPage(success(LATEST_VERSION), {
      kind: 'legal-notice',
      versionNumber: 3,
    });

    await expect.element(note()).toHaveTextContent('これは最新版です。');
    expect(note().element().textContent).not.toContain('最新版ではありません');
    await expect
      .element(note().getByRole('link', { name: '公開ページを見る' }))
      .toHaveAttribute('href', '/legal');
    const body = markdownBody();
    expect(body !== null && follows(note().element(), body)).toBe(true);
  });

  test('読み込み中は見出しの下に読み込み中の状態を示し、案内と本文を描かない', async () => {
    await renderPage({ status: 'pending' }, { versionNumber: 2 });

    await expect.element(heading()).toHaveTextContent('利用規約(第2版)');
    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent('読み込み中');
    expect(note().query()).toBeNull();
    expect(markdownBody()).toBeNull();
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

    await expect.element(heading()).toHaveTextContent('利用規約(第1版)');
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(
        '現在ご利用いただけません。時間をおいて再度お試しください。',
      );
    expect(main().getByRole('status').query()).toBeNull();
    expect(note().query()).toBeNull();
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
      ['過去の版', success(PAST_VERSION)],
      ['最新版', success(LATEST_VERSION)],
      ['読み込み中', { status: 'pending' } as const],
      [
        '取得の失敗',
        {
          status: 'error',
          error: new TypeError('Failed to fetch'),
          onRetry: () => undefined,
        } as const,
      ],
    ] satisfies readonly (readonly [string, LegalVersionPageState])[])(
      '%sの表示でアクセシビリティの検査の違反が0件',
      async (_label, state) => {
        await renderPage(state);
        await expect.element(heading()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
