import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  ClientMatchSupportersDocument,
  type ClientMatchSupportersQuery,
} from '../../graphql/generated/graphql.ts';
import { SupportersPanel } from './supporters-panel.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TARGET = {
  productHandle: 'Pitch-Notes',
  matchId: '01JD0MATCH0000000000000001',
  entryId: '01JD0ENTRY0000000000000001',
} as const;

const PANEL_ID = 'supporters-01JD0MATCH0000000000000001';

const NOTICE =
  'Upvoteした日時が早い順。退会・停止したユーザーは表示されません。';

const LOAD_ERROR = 'サポーター一覧を読み込めませんでした。';

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const AVATAR = {
  id: '01JD0FILE00000000000000001',
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG' as const,
  width: 512,
  height: 512,
};

type SupporterNode = NonNullable<
  ClientMatchSupportersQuery['matchSupporters']
>['nodes'][number];

const supporterOf = (index: number): SupporterNode => ({
  handle: `supporter_${String(index)}`,
  nickname: `サポーター${String(index)}号`,
  avatar: index === 1 ? AVATAR : null,
});

// 1から数えた番号のサポーターを並べたページ
const pageOf = (
  from: number,
  count: number,
  endCursor: string | null,
): ClientMatchSupportersQuery => ({
  matchSupporters: {
    nodes: Array.from({ length: count }, (_, index) =>
      supporterOf(from + index),
    ),
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

type Result = ClientMatchSupportersQuery | Error;

// 'pending'は応答しない。Promiseはテストが決めた時点で応答する
type Response = Result | 'pending' | Promise<Result>;

const resultOf = (result: Result) =>
  result instanceof Error
    ? { ok: false, error: result }
    : { ok: true, data: result };

// 呼ばれた順に応答を返し、尽きた後は最後の応答を繰り返す
const respondInOrder = (...responses: readonly Response[]) => {
  let calls = 0;
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document !== ClientMatchSupportersDocument) {
      return Promise.reject(new Error('想定外の操作です。'));
    }
    const response = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    if (response === undefined) {
      return Promise.reject(new Error('応答が指定されていません。'));
    }
    if (response === 'pending') {
      return new Promise(() => undefined);
    }
    if (response instanceof Promise) {
      return response.then(resultOf);
    }
    return Promise.resolve(resultOf(response));
  });
};

const deferredResult = () => {
  const { promise, resolve } = Promise.withResolvers<Result>();
  return { promise, resolve };
};

const supporterCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMatchSupportersDocument,
  );

const variablesOfCall = (index: number): unknown =>
  supporterCalls()[index]?.[1];

// マッチ履歴の行と同じく、開閉のボタンが一覧の開閉を切り替える
function TogglePanel({ initialOpen }: { readonly initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <main className="bg-background p-4 text-foreground">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        サポーター45人
      </button>
      <SupportersPanel id={PANEL_ID} open={open} {...TARGET} />
    </main>
  );
}

const renderPanel = (initialOpen = true) =>
  renderInRouter(<TogglePanel initialOpen={initialOpen} />, {
    path: '/p/Pitch-Notes',
  });

const list = () => page.getByRole('list', { name: 'サポーター一覧' });

const rows = () => list().getByRole('listitem');

const scrollArea = (): HTMLElement => {
  const element = list().element().parentElement;
  if (element === null) {
    throw new Error('一覧の枠がありません。');
  }
  return element;
};

const scrollToEnd = () => {
  const area = scrollArea();
  area.scrollTop = area.scrollHeight;
};

// リンクの名前にニックネームが重ねて入らないよう、プロフィール画像は支援技術から隠すため、要素の属性で探す。画像が読み込めないテストの環境では仮の表示に替わる
const avatarIn = (link: Element, nickname: string): Element | null =>
  link.querySelector(
    `[aria-hidden="true"] :is(img[alt="${nickname}のプロフィール画像"], [aria-label="${nickname}のプロフィール画像"])`,
  );

const retryButton = () => page.getByRole('button', { name: '再試行' });

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('SupportersPanel', () => {
  test('閉じている間は取得せず、開くとプロダクト・マッチ・出場の最初の20件を読む', async () => {
    respondInOrder(pageOf(1, 20, 'cursor-1'));
    await renderPanel(false);

    expect(document.getElementById(PANEL_ID)).not.toBeNull();
    expect(supporterCalls()).toStrictEqual([]);

    await userEvent.click(page.getByRole('button', { name: 'サポーター45人' }));

    await expect.poll(() => rows().elements().length).toBe(20);
    expect(supporterCalls()).toStrictEqual([
      [
        ClientMatchSupportersDocument,
        { ...TARGET, first: 20 },
        expect.anything(),
      ],
    ]);
  });

  test('注記を添え、各行をプロフィール画像とニックネームの公開プロフィールへのリンクにする', async () => {
    respondInOrder(pageOf(1, 3, null));
    await renderPanel();

    await expect.element(page.getByText(NOTICE)).toBeVisible();
    await expect.poll(() => rows().elements().length).toBe(3);
    const first = rows().first().getByRole('link');
    await expect.element(first).toHaveAccessibleName('サポーター1号');
    await expect.element(first).toHaveAttribute('href', '/@supporter_1');
    expect(avatarIn(first.element(), 'サポーター1号')).not.toBeNull();
    const third = rows().nth(2).getByRole('link', { name: 'サポーター3号' });
    await expect.element(third).toHaveAttribute('href', '/@supporter_3');
    expect(avatarIn(third.element(), 'サポーター3号')).toHaveAttribute(
      'data-slot',
      'media-placeholder',
    );
  });

  test('高さを制限した枠の中で、末尾までスクロールすると最後のカーソルから次の20件を後ろに加える', async () => {
    respondInOrder(
      pageOf(1, 20, 'cursor-1'),
      pageOf(21, 20, 'cursor-2'),
      pageOf(41, 5, null),
    );
    await renderPanel();

    await expect.poll(() => rows().elements().length).toBe(20);
    const area = scrollArea();
    expect(getComputedStyle(area).overflowY).toBe('auto');
    expect(area.scrollHeight).toBeGreaterThan(area.clientHeight);
    expect(supporterCalls()).toHaveLength(1);

    scrollToEnd();
    await expect.poll(() => rows().elements().length).toBe(40);
    expect(variablesOfCall(1)).toStrictEqual({
      ...TARGET,
      first: 20,
      after: 'cursor-1',
    });

    scrollToEnd();
    await expect.poll(() => rows().elements().length).toBe(45);
    expect(variablesOfCall(2)).toStrictEqual({
      ...TARGET,
      first: 20,
      after: 'cursor-2',
    });
    await expect
      .element(rows().nth(44).getByRole('link'))
      .toHaveAccessibleName('サポーター45号');

    scrollToEnd();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(supporterCalls()).toHaveLength(3);
  });

  test('最初の読み込み中を支援技術へ伝える', async () => {
    respondInOrder('pending');
    await renderPanel();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(/^読み込み中$/);
    expect(page.getByRole('list').elements()).toStrictEqual([]);
  });

  test('続きの読み込み中は読み込んだ行を残したまま支援技術へ伝える', async () => {
    respondInOrder(pageOf(1, 20, 'cursor-1'), 'pending');
    await renderPanel();
    await expect.poll(() => rows().elements().length).toBe(20);
    scrollToEnd();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(/^続きを読み込み中$/);
    expect(rows().elements()).toHaveLength(20);
    expect(scrollArea().getAttribute('aria-busy')).toBe('true');
  });

  test('続きの取得に失敗したら読み込んだ行を残して文言と再試行を示し、再試行で同じ位置から読み直す', async () => {
    respondInOrder(
      pageOf(1, 20, 'cursor-1'),
      INTERNAL_ERROR,
      pageOf(21, 3, null),
    );
    await renderPanel();
    await expect.poll(() => rows().elements().length).toBe(20);

    scrollToEnd();

    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(rows().elements()).toHaveLength(20);
    scrollToEnd();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(supporterCalls()).toHaveLength(2);

    await userEvent.click(retryButton());

    await expect.poll(() => rows().elements().length).toBe(23);
    expect(variablesOfCall(2)).toStrictEqual({
      ...TARGET,
      first: 20,
      after: 'cursor-1',
    });
    expect(page.getByRole('alert').elements()).toStrictEqual([]);
    expect(document.activeElement).not.toBe(document.body);
  });

  test('最初の取得に失敗したら文言と再試行を示し、再試行で最初のページを読み直す', async () => {
    respondInOrder(INTERNAL_ERROR, pageOf(1, 2, null));
    await renderPanel();

    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    expect(page.getByRole('list').elements()).toStrictEqual([]);

    await userEvent.click(retryButton());

    await expect.poll(() => rows().elements().length).toBe(2);
    expect(variablesOfCall(1)).toStrictEqual({ ...TARGET, first: 20 });
    expect(page.getByRole('alert').elements()).toStrictEqual([]);
    expect(document.activeElement).not.toBe(document.body);
  });

  test('マッチを表示できなくなった(null)時は行を描かず注記だけを示す', async () => {
    respondInOrder({ matchSupporters: null });
    await renderPanel();

    await expect.poll(() => supporterCalls().length).toBe(1);
    await expect.element(page.getByText(NOTICE)).toBeVisible();
    await expect.poll(() => page.getByRole('status').elements().length).toBe(0);
    expect(page.getByRole('list').elements()).toStrictEqual([]);
    expect(page.getByRole('alert').elements()).toStrictEqual([]);
  });

  test('閉じると一覧を隠し、開き直すと読み込んだ行を取り直さずに示す', async () => {
    respondInOrder(pageOf(1, 3, null));
    await renderPanel();
    await expect.poll(() => rows().elements().length).toBe(3);
    const toggle = page.getByRole('button', { name: 'サポーター45人' });

    await userEvent.click(toggle);
    await expect.element(page.getByText(NOTICE)).not.toBeVisible();
    expect(page.getByRole('list').elements()).toStrictEqual([]);
    await userEvent.click(toggle);

    await expect.poll(() => rows().elements().length).toBe(3);
    expect(supporterCalls()).toHaveLength(1);
  });

  test('続きの再試行が再び失敗したら、新しい再試行のボタンへフォーカスを移す', async () => {
    respondInOrder(pageOf(1, 20, 'cursor-1'), INTERNAL_ERROR);
    await renderPanel();
    await expect.poll(() => rows().elements().length).toBe(20);
    scrollToEnd();
    await expect.element(retryButton()).toBeVisible();

    await userEvent.click(retryButton());

    await expect.poll(() => supporterCalls().length).toBe(3);
    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    await expect.element(retryButton()).toHaveFocus();
    expect(rows().elements()).toHaveLength(20);
  });

  test('最初の再試行が再び失敗したら、新しい再試行のボタンへフォーカスを移す', async () => {
    respondInOrder(INTERNAL_ERROR);
    await renderPanel();
    await expect.element(retryButton()).toBeVisible();

    await userEvent.click(retryButton());

    await expect.poll(() => supporterCalls().length).toBe(2);
    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    await expect.element(retryButton()).toHaveFocus();
  });

  test.each([
    ['マッチを表示できなくなった(null)', { matchSupporters: null }],
    ['サポーターが0件だった', pageOf(1, 0, null)],
  ] as const)(
    '最初の再試行で%s時は、枠が外れてもフォーカスを一覧の区画に残す',
    async (_case, result) => {
      respondInOrder(INTERNAL_ERROR, result);
      await renderPanel();
      await expect.element(retryButton()).toBeVisible();

      await userEvent.click(retryButton());

      await expect.poll(() => supporterCalls().length).toBe(2);
      await expect
        .poll(() => page.getByRole('alert').elements().length)
        .toBe(0);
      expect(document.activeElement).toBe(document.getElementById(PANEL_ID));
    },
  );

  test('再試行の取得を待つ間に利用者が一覧の外へフォーカスを移したら、再び失敗してもフォーカスを奪わない', async () => {
    const retried = deferredResult();
    respondInOrder(INTERNAL_ERROR, retried.promise);
    await renderPanel();
    await expect.element(retryButton()).toBeVisible();
    await userEvent.click(retryButton());
    await expect.poll(() => supporterCalls().length).toBe(2);
    const toggle = page.getByRole('button', { name: 'サポーター45人' });
    toggle.element().focus();

    retried.resolve(INTERNAL_ERROR);

    await expect.element(page.getByRole('alert')).toHaveTextContent(LOAD_ERROR);
    await expect.element(toggle).toHaveFocus();
  });

  test.each(
    (['rows', 'error'] as const).flatMap((state) =>
      COLOR_SCHEMES.map((scheme) => [state, scheme] as const),
    ),
  )('%s・%sの配色でaxeの違反が0件である', async (state, scheme) => {
    applyColorScheme(scheme);
    respondInOrder(
      pageOf(1, 20, 'cursor-1'),
      state === 'error' ? INTERNAL_ERROR : pageOf(21, 20, null),
    );
    await renderPanel();
    await expect.poll(() => rows().elements().length).toBe(20);
    scrollToEnd();

    if (state === 'error') {
      await expect.element(page.getByRole('alert')).toBeVisible();
    } else {
      await expect.poll(() => rows().elements().length).toBe(40);
    }
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
