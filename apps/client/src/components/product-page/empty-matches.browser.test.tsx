import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { EmptyMatches } from './empty-matches.tsx';
import { historyLaunchOf } from './match-history-fixtures.ts';
import type { ProductPageLaunchView } from './match-history-model.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const NOW = new Date('2026-11-10T08:00:00.000Z');

const UPCOMING = historyLaunchOf({
  status: 'PAIRED',
  launchDate: '2026-11-15',
  kickoffAt: '2026-11-14T15:00:00.000Z',
  summary: { label: 'キックオフ予定', inMatch: false },
  kickedOff: false,
  latestKickedOff: false,
  matches: [],
});

const LIVE = historyLaunchOf({
  status: 'IN_PROGRESS',
  launchDate: '2026-11-10',
  summary: { label: '予選マッチ中', inMatch: true },
  kickedOff: true,
  latestKickedOff: true,
  matches: [],
});

const OWNER_NOTE =
  '当日はトップページで対戦が始まります。リンクを共有して応援を呼びかけましょう。';

const GUEST_NOTE =
  'まだ終了したマッチはありません。当日はトップページで対戦が始まります。';

const renderEmpty = (launch: ProductPageLaunchView, isOwner: boolean) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <main className="bg-background p-4 text-foreground">
        <EmptyMatches
          launch={launch}
          isOwner={isOwner}
          productHandle="Pitch-Notes"
        />
      </main>
      <Toaster />
    </DisplayPreferencesProvider>,
    { path: '/p/pitch-notes' },
  );

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  toast.dismiss();
  applyColorScheme('light');
});

describe('EmptyMatches', () => {
  test('予選マッチが開催中のローンチは、勝敗をフルタイム後に示す旨と開催中のマッチの区画への「マッチを見る」を示す', async () => {
    await renderEmpty(LIVE, false);

    await expect
      .element(
        page.getByText(
          '予選マッチが行われています。勝敗はフルタイム後にここへ表示されます。',
          { exact: true },
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'マッチを見る' }))
      .toHaveAttribute('href', '#live-match-heading');
  });

  test('キックオフ前のローンチは、他の閲覧者にキックオフの日付と文言とトップページへの導線を示す', async () => {
    await renderEmpty(UPCOMING, false);

    const date = page.getByText('11月15日', { exact: true });
    await expect.element(date).toBeVisible();
    expect(date.element().tagName).toBe('TIME');
    expect(date.element().getAttribute('datetime')).toBe('2026-11-15');
    expect(date.element().parentElement?.textContent).toBe(
      '11月15日にキックオフします。',
    );
    await expect
      .element(page.getByText(GUEST_NOTE, { exact: true }))
      .toBeVisible();
    await expect
      .element(
        page.getByRole('link', { name: 'トップページで本日のマッチを見る' }),
      )
      .toHaveAttribute('href', '/');
    expect(page.getByText(OWNER_NOTE).elements()).toStrictEqual([]);
    expect(page.getByRole('button').elements()).toStrictEqual([]);
  });

  test('キックオフ前のローンチは、投稿者本人に応援を呼びかける文言とリンクのコピーを示し、正規のURLを写す', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    await renderEmpty(UPCOMING, true);

    await expect
      .element(page.getByText('11月15日', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText(OWNER_NOTE, { exact: true }))
      .toBeVisible();
    expect(page.getByText(GUEST_NOTE).elements()).toStrictEqual([]);
    expect(
      page
        .getByRole('link', { name: 'トップページで本日のマッチを見る' })
        .elements(),
    ).toStrictEqual([]);

    await userEvent.click(
      page.getByRole('button', { name: 'リンクをコピーして応援を呼びかける' }),
    );

    await expect
      .element(page.getByText('リンクをコピーしました。'))
      .toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'https://client.example/p/Pitch-Notes',
    );
  });

  test('結果の確定したマッチの無い終了したローンチには何も描かない', async () => {
    await renderEmpty(
      historyLaunchOf({ status: 'FINISHED', kickedOff: true, matches: [] }),
      true,
    );

    expect(page.getByRole('main').element().textContent).toBe('');
  });

  test.each(
    (['開催中', '本人のキックオフ前', '他者のキックオフ前'] as const).flatMap(
      (state) => COLOR_SCHEMES.map((scheme) => [state, scheme] as const),
    ),
  )('%sの表示・%sの配色でaxeの違反が0件である', async (state, scheme) => {
    applyColorScheme(scheme);
    await renderEmpty(
      state === '開催中' ? LIVE : UPCOMING,
      state === '本人のキックオフ前',
    );
    await expect
      .element(page.getByRole('main').getByRole('paragraph').first())
      .toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
