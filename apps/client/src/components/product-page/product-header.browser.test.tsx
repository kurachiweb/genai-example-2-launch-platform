import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientOwnerFollowStatusDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import type { ProductPageView } from '../../graphql/product-page.ts';
import { ProductHeader } from './product-header.tsx';
import { productPageViewOf } from './product-page-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const NOW = new Date('2026-11-10T08:00:00.000Z');

const AWARDS: ProductPageView['awards'] = [
  {
    kind: 'WEEK',
    count: 2,
    labels: ['2026年第37週(9/7〜9/13)', '2026年第38週(9/14〜9/20)'],
  },
  { kind: 'YEAR', count: 1, labels: ['2025年'] },
];

const VIEWER_QUERY = signedInViewerQuery();

const renderHeader = (
  overrides: Partial<ProductPageView> = {},
  viewerQuery: ClientViewerQuery = GUEST_VIEWER_QUERY,
) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <TooltipProvider>
        <main className="bg-background p-4 text-foreground">
          <ProductHeader page={productPageViewOf(overrides)} />
        </main>
        <Toaster />
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { cachedViewer: viewerQuery, path: '/p/pitch-notes' },
  );

const header = () => page.getByRole('region', { name: 'Pitch Notes' });

const followButton = () => page.getByRole('button', { name: 'フォロー' });

const definitionOf = (term: string): HTMLElement => {
  const termElement = Array.from(
    header().element().querySelectorAll('dt'),
  ).find((element) => element.textContent === term);
  const definition = termElement?.nextElementSibling;
  if (!(definition instanceof HTMLElement) || definition.tagName !== 'DD') {
    throw new Error(`「${term}」の値がありません。`);
  }
  return definition;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  executeGraphQL.mockReset();
  executeGraphQL.mockResolvedValue({
    ok: true,
    data: {
      publicProfile: {
        __typename: 'PublicProfile',
        viewerRelation: 'NOT_FOLLOWING',
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  toast.dismiss();
  applyColorScheme('light');
});

describe('ProductHeader', () => {
  test('名称をページの見出しにした区画に、ロゴ・タグラインを示す', async () => {
    await renderHeader();

    await expect
      .element(header().getByRole('heading', { level: 1 }))
      .toHaveTextContent('Pitch Notes');
    await expect
      .element(header().getByRole('img', { name: 'Pitch Notesのロゴ' }))
      .toBeVisible();
    await expect
      .element(header().getByText('ピッチの台本を書いて練習できるノートアプリ'))
      .toBeVisible();
  });

  test('カテゴリはカテゴリ名を示し、そのカテゴリだけで絞り込んだディレクトリへ導く', async () => {
    await renderHeader();

    const link = header().getByRole('link', {
      name: 'カテゴリ「開発ツール」で絞り込む',
    });
    await expect.element(link).toHaveTextContent('開発ツール');
    await expect.element(link).toHaveAttribute('href', '/p?category=dev-tools');
    await expect.element(link).not.toHaveAttribute('aria-current');
  });

  test('受賞回数は受賞の合計を「受賞3回」と示し、リンクにも操作にもしない', async () => {
    await renderHeader({ awards: AWARDS });

    const awardCount = header().getByText('受賞3回');
    await expect.element(awardCount).toBeVisible();
    expect(awardCount.element().closest('a, button')).toBeNull();
  });

  test('受賞が無ければ受賞回数を示さない', async () => {
    await renderHeader();

    expect(header().getByText(/^受賞/u).elements()).toStrictEqual([]);
  });

  test('投稿者はラベル・ニックネーム・ハンドルを示し、公開プロフィールへ導く', async () => {
    await renderHeader();

    const ownerLink = header().getByRole('link', {
      name: /スカウトの健\s*@scout_ken/u,
    });
    await expect.element(ownerLink).toHaveAttribute('href', '/@scout_ken');
    await expect
      .element(header().getByText('投稿者', { exact: true }))
      .toBeVisible();
    await expect.element(header().getByText('@scout_ken')).toBeVisible();
  });

  test('「サイトを開く」は外部Webサイトを別タブで開き、relをnoopenerだけにする', async () => {
    await renderHeader();

    const siteLink = header().getByRole('link', {
      name: /^Pitch Notesの\s*サイトを開く\s*\(新しいタブで開きます\)$/u,
    });
    await expect
      .element(siteLink)
      .toHaveAttribute('href', 'https://pitch-notes.example/');
    await expect.element(siteLink).toHaveAttribute('target', '_blank');
    await expect.element(siteLink).toHaveAttribute('rel', 'noopener');
  });

  test('リンクにできない外部WebサイトURLでは「サイトを開く」を出さない', async () => {
    await renderHeader({ websiteUrl: '' });

    expect(
      header()
        .getByRole('link', { name: /サイトを開く/u })
        .elements(),
    ).toStrictEqual([]);
    await expect
      .element(header().getByRole('button', { name: 'リンクをコピー' }))
      .toBeVisible();
  });

  test('初ローンチ日・ローンチ回数・通算成績を示し、日付を日時の要素にする', async () => {
    await renderHeader({
      record: {
        firstLaunchDate: '2025-09-15',
        launchCount: 3,
        wins: 5,
        losses: 2,
      },
    });

    const firstLaunch = definitionOf('初ローンチ').querySelector('time');
    expect(firstLaunch?.getAttribute('datetime')).toBe('2025-09-15');
    expect(firstLaunch?.textContent).toBe('2025年9月15日');
    expect(definitionOf('ローンチ').textContent).toBe('3回');
    expect(definitionOf('通算成績').textContent).toBe('5勝2敗');
  });

  test('今年の初ローンチ日は年を省く', async () => {
    await renderHeader();

    expect(definitionOf('初ローンチ').textContent).toBe('9月15日');
  });

  test('キックオフ済みのローンチが無ければ、初ローンチ日・ローンチ回数・通算成績の欄を出さない', async () => {
    await renderHeader({
      record: { firstLaunchDate: null, launchCount: 0, wins: 0, losses: 0 },
    });

    expect(header().element().querySelector('dl')).toBeNull();
  });

  test('未ログインの閲覧者には、照会せずにフォローボタン(ログインの案内)を示す', async () => {
    await renderHeader();

    await expect.element(followButton()).toBeVisible();
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('ログイン中の他者には、フォロー中の照会の結果でフォローボタンを示す', async () => {
    await renderHeader({}, VIEWER_QUERY);

    await expect
      .element(followButton())
      .toHaveAttribute('aria-pressed', 'false');
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientOwnerFollowStatusDocument,
      { handle: 'scout_ken' },
      expect.anything(),
    );
  });

  test('投稿者本人にはフォローボタンを示さない', async () => {
    await renderHeader(
      {
        viewerIsOwner: true,
        owner: {
          handle: 'pitch_maker',
          nickname: 'ピッチの作り手',
          avatar: null,
        },
      },
      VIEWER_QUERY,
    );

    await expect
      .element(header().getByRole('link', { name: /ピッチの作り手/u }))
      .toBeVisible();
    expect(
      page.getByRole('button', { name: /フォロー/u }).elements(),
    ).toStrictEqual([]);
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('「リンクをコピー」は現在のハンドルの正規のURLを写して通知する', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    await renderHeader();

    await userEvent.click(
      header().getByRole('button', { name: 'リンクをコピー' }),
    );

    await expect
      .element(page.getByText('リンクをコピーしました。'))
      .toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'https://client.example/p/Pitch-Notes',
    );
  });

  test.each(
    (['他者', '本人'] as const).flatMap((viewer) =>
      COLOR_SCHEMES.map((scheme) => [viewer, scheme] as const),
    ),
  )('%sの閲覧・%sの配色でaxeの違反が0件である', async (viewer, scheme) => {
    applyColorScheme(scheme);
    await renderHeader(
      { awards: AWARDS, viewerIsOwner: viewer === '本人' },
      VIEWER_QUERY,
    );
    if (viewer === '他者') {
      await expect.element(followButton()).toBeVisible();
    }

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
