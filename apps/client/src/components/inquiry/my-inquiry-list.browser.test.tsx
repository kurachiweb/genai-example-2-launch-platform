import { useState } from 'react';
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
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  ClientMyInquiriesDocument,
  type ClientMyInquiriesQuery,
  type ClientMyInquiriesQueryVariables,
} from '../../graphql/generated/graphql.ts';
import { MyInquiryList } from './my-inquiry-list.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const VIEWER_ID = '01JC0VIEWER0000000000000000';

type MyInquiryRow = ClientMyInquiriesQuery['myInquiries']['items'][number];

const BUG_REPORT: MyInquiryRow = {
  id: '01JC0INQVRY000000000000002',
  category: { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
  status: 'IN_PROGRESS',
  createdAt: '2026-11-04T01:00:00.000Z',
  lastMessageAt: '2026-11-05T02:30:00.000Z',
};

const OTHER: MyInquiryRow = {
  id: '01JC0INQVRY000000000000001',
  category: { id: '01JC0000000000000000000000', name: 'その他' },
  status: 'RESOLVED',
  createdAt: '2026-11-03T01:00:00.000Z',
  lastMessageAt: '2026-11-03T01:00:00.000Z',
};

const LOAD_FAILURE = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const pageOf = (
  items: readonly MyInquiryRow[],
  nextCursor: string | null = null,
) => ({ ok: true, data: { myInquiries: { items, nextCursor } } });

// 位置ごとに1件ずつのページを返し、cursor-3が最後のページ
const PAGED_RESULTS: Readonly<Record<string, ReturnType<typeof pageOf>>> = {
  first: pageOf([BUG_REPORT], 'cursor-2'),
  'cursor-2': pageOf([OTHER], 'cursor-3'),
  'cursor-3': pageOf([{ ...OTHER, id: '01JC0INQVRY000000000000000' }]),
};

const respondByCursor = () => {
  executeGraphQL.mockImplementation(
    (_document: unknown, variables: ClientMyInquiriesQueryVariables) =>
      Promise.resolve(PAGED_RESULTS[variables.after ?? 'first']),
  );
};

const region = () => page.getByRole('region', { name: '送信した問い合わせ' });
const items = () => region().getByRole('listitem');
const pageNavigation = () =>
  page.getByRole('navigation', { name: '送信した問い合わせのページ送り' });
const previousButton = () =>
  pageNavigation().getByRole('button', { name: '前へ', exact: true });
const nextButton = () =>
  pageNavigation().getByRole('button', { name: '次へ', exact: true });

// 検索パラメータの代わりに状態でページの位置を持ち、経路の部品と同じく受け取った位置で描き直す
function ListOnPage({
  initialAfter,
  onShowPage,
}: {
  readonly initialAfter: string | undefined;
  readonly onShowPage: (after: string | undefined) => void;
}) {
  const [after, setAfter] = useState(initialAfter);
  return (
    <MyInquiryList
      viewerId={VIEWER_ID}
      after={after}
      onShowPage={(next) => {
        onShowPage(next);
        setAfter(next);
      }}
    />
  );
}

const renderList = (
  initialAfter?: string,
  onShowPage: (after: string | undefined) => void = vi.fn(),
) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <div className="p-4">
        <ListOnPage initialAfter={initialAfter} onShowPage={onShowPage} />
      </div>
    </DisplayPreferencesProvider>,
    { path: '/contact' },
  );

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('MyInquiryList', () => {
  test('見出し付きの区画に、各行のステータス・カテゴリのチャットへのリンク・送信日時・最後のメッセージの日時を応答の順に並べる', async () => {
    executeGraphQL.mockResolvedValue(pageOf([BUG_REPORT, OTHER]));

    await renderList();

    await expect
      .element(region().getByRole('heading', { level: 2 }))
      .toHaveTextContent('送信した問い合わせ');
    await expect.element(items().first()).toBeInTheDocument();
    expect(items().elements()).toHaveLength(2);
    const first = items().first();
    await expect.element(first).toHaveTextContent('対応中');
    await expect
      .element(first.getByRole('link', { name: '不具合の報告' }))
      .toHaveAttribute('href', '/inquiries/01JC0INQVRY000000000000002');
    const times = first.element().querySelectorAll('time');
    expect(
      [...times].map((time) => [
        time.getAttribute('datetime'),
        time.textContent,
      ]),
    ).toStrictEqual([
      ['2026-11-04T01:00:00.000Z', '2026年11月4日(水) 10:00'],
      ['2026-11-05T02:30:00.000Z', '2026年11月5日(木) 11:30'],
    ]);
    await expect.element(first).toHaveTextContent('送信日時');
    await expect.element(first).toHaveTextContent('最後のメッセージ');
    await expect.element(items().nth(1)).toHaveTextContent('対応済');
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientMyInquiriesDocument,
      {},
      expect.anything(),
    );
  });

  test('問い合わせが1件も無ければ、一覧の位置に無い旨を表示し、ページ送りを描かない', async () => {
    executeGraphQL.mockResolvedValue(pageOf([]));

    await renderList();

    await expect
      .element(region())
      .toHaveTextContent('送信した問い合わせはまだありません。');
    expect(region().getByRole('list').query()).toBeNull();
    expect(pageNavigation().query()).toBeNull();
  });

  test('1ページ目で次のページがあれば、前へを押せなくして次へで次のページへ移る', async () => {
    respondByCursor();
    const onShowPage = vi.fn();

    await renderList(undefined, onShowPage);

    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    await nextButton().click();

    expect(onShowPage).toHaveBeenCalledExactlyOnceWith('cursor-2');
    await expect.element(items().first()).toHaveTextContent('その他');
  });

  test('次へで辿ったページからは、前へで直前に開いたページへ戻り、最後のページでは次へを押せなくする', async () => {
    respondByCursor();
    const onShowPage = vi.fn();
    await renderList(undefined, onShowPage);

    await nextButton().click();
    await expect.element(items().first()).toHaveTextContent('その他');
    await nextButton().click();
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');
    await previousButton().click();
    await expect.element(nextButton()).not.toHaveAttribute('aria-disabled');
    await previousButton().click();

    expect(onShowPage.mock.calls).toStrictEqual([
      ['cursor-2'],
      ['cursor-3'],
      ['cursor-2'],
      [undefined],
    ]);
    await expect.element(items().first()).toHaveTextContent('不具合の報告');
  });

  test('記録の無い途中のページからは、前へで1ページ目へ戻る', async () => {
    respondByCursor();
    const onShowPage = vi.fn();
    await renderList('cursor-3', onShowPage);

    await expect.element(previousButton()).not.toHaveAttribute('aria-disabled');
    await previousButton().click();

    expect(onShowPage).toHaveBeenCalledExactlyOnceWith(undefined);
    await expect.element(items().first()).toHaveTextContent('不具合の報告');
  });

  test('取得の失敗は一覧の位置に警告として示し、再試行で見出しへフォーカスを移して取得し直す', async () => {
    executeGraphQL
      .mockResolvedValueOnce({ ok: false, error: LOAD_FAILURE })
      .mockResolvedValue(pageOf([BUG_REPORT]));
    await renderList();

    await expect
      .element(region().getByRole('alert'))
      .toHaveTextContent(LOAD_FAILURE.message);
    await userEvent.click(region().getByRole('button', { name: '再試行' }));

    await expect
      .element(region().getByRole('heading', { level: 2 }))
      .toHaveFocus();
    await expect.element(items().first()).toHaveTextContent('不具合の報告');
    expect(executeGraphQL).toHaveBeenCalledTimes(2);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      [
        '一覧とページ送り',
        () => {
          respondByCursor();
        },
      ],
      [
        '空',
        () => {
          executeGraphQL.mockResolvedValue(pageOf([]));
        },
      ],
      [
        '取得の失敗',
        () => {
          executeGraphQL.mockResolvedValue({ ok: false, error: LOAD_FAILURE });
        },
      ],
    ])(
      '%sの状態で、アクセシビリティの検査の違反が0件',
      async (_state, respond) => {
        applyColorScheme(scheme);
        respond();
        await renderList();
        await expect
          .element(region().getByRole('heading', { level: 2 }))
          .toBeInTheDocument();
        await expect
          .poll(() => region().element().querySelector('[aria-busy="true"]'))
          .toBeNull();

        expect(await runAxe(region().element())).toStrictEqual([]);
      },
    );
  });
});
