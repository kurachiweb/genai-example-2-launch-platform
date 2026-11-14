import { notifyManager } from '@tanstack/react-query';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { reportUnexpectedErrorInBrowser } from '../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../lib/test/a11y.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { entryOf } from '../src/components/match/match-fixtures.ts';
import {
  qualifierBoardOf,
  qualifierMatchOf,
} from '../src/components/top/qualifier-board-fixtures.ts';
import type * as QualifierSectionModule from '../src/components/top/qualifier-section.tsx';
import {
  ClientQualifierBoardDocument,
  ClientUpvoteDocument,
  type MatchFragment,
} from '../src/graphql/generated/graphql.ts';
import {
  boardCallsOf,
  boardResult,
  renderTopPage,
} from './top-page-fixtures.ts';

const { executeGraphQL, qualifierListFailure } = vi.hoisted(() => ({
  executeGraphQL: vi.fn(),
  qualifierListFailure: { enabled: false },
}));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

// 予選の一覧の描画の失敗を再現するため、目印が立っている間だけ予選の区画の部品が例外を投げる
vi.mock(
  '../src/components/top/qualifier-section.tsx',
  async (importOriginal) => {
    const actual = await importOriginal<typeof QualifierSectionModule>();
    return {
      ...actual,
      QualifierSection: (
        props: QualifierSectionModule.QualifierSectionProps,
      ) => {
        if (qualifierListFailure.enabled) {
          throw new Error('予選の一覧の描画の失敗');
        }
        return createElement(actual.QualifierSection, props);
      },
    };
  },
);

const DESKTOP = { width: 1280, height: 900 } as const;

const ERROR_MESSAGE =
  'マッチを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const EMPTY_MESSAGE = '本日のマッチはありません。ローンチを予約しましょう。';

const HERO_TITLE = '1対1のマッチでローンチ。必ず半分は勝者になる。';

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const main = () => page.getByRole('main');
const qualifierSection = () => main().getByRole('region', { name: /^予選/u });
const cardNames = () =>
  qualifierSection()
    .getByRole('article')
    .elements()
    .map((card) => card.getAttribute('aria-label') ?? '');
const countdown = () =>
  main().getByRole('region', { name: 'フルタイムまでの残り時間' });
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });

// 各側のUpvote数を置き換えたn番目の予選の対戦カード
const matchWithCounts = (
  n: number,
  left: number,
  right: number,
  overrides: Partial<MatchFragment> = {},
): MatchFragment => {
  const base = qualifierMatchOf(n);
  const [leftEntry, rightEntry] = base.entries;
  return {
    ...base,
    entries: [
      entryOf('left', { ...leftEntry, upvoteCount: left }),
      entryOf('right', { ...rightEntry, upvoteCount: right }),
    ],
    ...overrides,
  };
};

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  qualifierListFailure.enabled = false;
  vi.mocked(reportUnexpectedErrorInBrowser).mockImplementation(() => undefined);
});

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('トップページの経路', () => {
  test('予選の取得を1回だけ行い、カウントダウン・自動更新の切り替え・未ログインの案内・予選の区画を描き、bot対策のウィジェットを1つ置く', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    executeGraphQL.mockResolvedValue(boardResult(qualifierBoardOf()));

    await renderTopPage();

    await expect.element(qualifierSection()).toBeVisible();
    await expect.element(countdown()).toBeVisible();
    await expect.element(autoRefreshSwitch()).toBeChecked();
    await expect
      .element(main().getByRole('heading', { level: 2, name: HERO_TITLE }))
      .toBeVisible();
    expect(cardNames()).toHaveLength(3);
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('Launch Stadium');
    expect(boardCallsOf(executeGraphQL)).toHaveLength(1);
    expect(lastTurnstileProps().options?.action).toBe('match_upvote');
    expect(page.getByTestId('fake-turnstile').elements()).toHaveLength(1);
    expect(
      main().element().querySelector('[data-auto-refresh="on"]'),
    ).not.toBeNull();
    expect(await runAxe(main().element())).toHaveLength(0);
  });

  test('ログイン中は未ログインの案内を出さない', async () => {
    executeGraphQL.mockResolvedValue(boardResult(qualifierBoardOf()));

    await renderTopPage({ signedIn: true });

    await expect.element(qualifierSection()).toBeVisible();
    expect(
      main().getByRole('heading', { name: HERO_TITLE }).elements(),
    ).toHaveLength(0);
  });

  test('当日の予選のマッチも不戦勝も無ければ、予選の区画に空の状態を出す', async () => {
    executeGraphQL.mockResolvedValue(
      boardResult(qualifierBoardOf({ matches: [], byes: [], heldCount: 0 })),
    );

    await renderTopPage();

    await expect
      .element(qualifierSection().getByText(EMPTY_MESSAGE))
      .toBeVisible();
    expect(await runAxe(main().element())).toHaveLength(0);
  });

  test('Upvoteの成功で、取り直さずにサーバーが返した値で対戦カードを更新し、並び順を保つ', async () => {
    const matches = [
      matchWithCounts(1, 12, 9),
      matchWithCounts(2, 1, 0),
      matchWithCounts(3, 2, 2),
    ];
    const [, second] = matches;
    const updated = matchWithCounts(2, 1, 1, {
      viewerUpvotedEntryId: second?.entries[1]?.id ?? null,
    });
    executeGraphQL.mockImplementation((document: unknown) =>
      Promise.resolve(
        document === ClientUpvoteDocument
          ? { ok: true, data: { upvote: updated } }
          : boardResult(qualifierBoardOf({ matches })),
      ),
    );
    await renderTopPage({ signedIn: true });
    const before = cardNames();
    await userEvent.click(
      page.getByRole('button', { name: '判定を成功させる' }),
    );

    await userEvent.click(
      qualifierSection().getByRole('button', { name: /^Right 2にUpvote/u }),
    );

    await expect
      .element(
        qualifierSection().getByRole('button', {
          name: /^Right 2へのUpvoteを取り消す/u,
        }),
      )
      .toBeVisible();
    expect(cardNames()).toStrictEqual(before);
    expect(boardCallsOf(executeGraphQL)).toHaveLength(1);
  });

  test('取得の失敗では、失敗の文言と再試行・問い合わせの導線を示し、再試行で取得し直してページの見出しへフォーカスを移す', async () => {
    executeGraphQL.mockResolvedValueOnce({ ok: false, error: INTERNAL_ERROR });
    executeGraphQL.mockResolvedValue(boardResult(qualifierBoardOf()));

    await renderTopPage();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    expect(await runAxe(main().element())).toHaveLength(0);

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(qualifierSection()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientQualifierBoardDocument,
      {},
      expect.anything(),
    );
  });

  test('予選の一覧の描画が失敗しても、その位置に失敗と再試行・問い合わせの導線を留め、カウントダウンと自動更新の切り替えの表示を続ける', async () => {
    qualifierListFailure.enabled = true;
    executeGraphQL.mockResolvedValue(boardResult(qualifierBoardOf()));

    await renderTopPage();

    await expect.element(main().getByText(UNEXPECTED_MESSAGE)).toBeVisible();
    await expect.element(countdown()).toBeVisible();
    await expect.element(autoRefreshSwitch()).toBeVisible();
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');

    qualifierListFailure.enabled = false;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(qualifierSection()).toBeVisible();
    expect(cardNames()).toHaveLength(3);
  });

  test('予選の区画が描画に失敗している間も、終了の時刻の1秒後に予選を取り直し、結果の時間帯に入るとカウントダウンを外す', async () => {
    // 業務日付2026-11-10の終了の時刻(23:40)の1分前
    const beforeFullTime = new Date('2026-11-10T14:39:00.000Z');
    notifyManager.setScheduler(queueMicrotask);
    vi.useFakeTimers({
      now: beforeFullTime,
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    qualifierListFailure.enabled = true;
    executeGraphQL.mockResolvedValueOnce(
      boardResult(
        qualifierBoardOf({ serverTime: beforeFullTime.toISOString() }),
      ),
    );
    executeGraphQL.mockResolvedValue(
      boardResult(
        qualifierBoardOf({
          phase: 'RESULT',
          serverTime: '2026-11-10T14:40:01.000Z',
          matches: [1, 2].map((n) =>
            qualifierMatchOf(n, { phase: 'TALLYING' }),
          ),
        }),
      ),
    );
    await renderTopPage();
    await expect.element(main().getByText(UNEXPECTED_MESSAGE)).toBeVisible();
    await expect.element(countdown()).toBeVisible();

    await vi.advanceTimersByTimeAsync(61_000 - 1);
    expect(boardCallsOf(executeGraphQL)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(() => boardCallsOf(executeGraphQL).length).toBe(2);
    await expect.element(countdown()).not.toBeInTheDocument();
    await expect.element(main().getByText(UNEXPECTED_MESSAGE)).toBeVisible();
  });
});
