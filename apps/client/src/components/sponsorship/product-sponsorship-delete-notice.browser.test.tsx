import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientActiveSponsorshipCountDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { activeSponsorshipCountQueryOptions } from '../../graphql/sponsorship.ts';
import { ProductSponsorshipDeleteNotice } from './product-sponsorship-delete-notice.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const NOTICE =
  'このプロダクトの掲載中・掲載予定のスポンサー広告は終了し、返金されません。';

const PRODUCT_HANDLE = 'kickoff-board';

const OTHER_CONTENT = '削除の確認';

const SIGNED_IN_VIEWER = signedInViewerQuery();

const LOAD_FAILURE = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

const respond = (result: unknown): void => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientActiveSponsorshipCountDocument
      ? Promise.resolve(result)
      : Promise.reject(new Error('想定外の操作です。')),
  );
};

const respondWithCount = (count: number): void => {
  respond({ ok: true, data: { activeSponsorshipCount: count } });
};

const countCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientActiveSponsorshipCountDocument,
  );

const renderNotice = async (
  viewerQuery: ClientViewerQuery = SIGNED_IN_VIEWER,
): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <div data-testid="notice-host">
        <RecoverableSlot contactAvailable={false}>
          <ProductSponsorshipDeleteNotice productHandle={PRODUCT_HANDLE} />
        </RecoverableSlot>
      </div>
      <p>{OTHER_CONTENT}</p>
    </main>,
    { context, cachedViewer: viewerQuery },
  );
  return context;
};

const waitForSettled = async (context: RouterContext) => {
  const viewer = SIGNED_IN_VIEWER.viewer;
  if (viewer === null) {
    throw new Error('ログイン中の閲覧者の値が必要です。');
  }
  await vi.waitFor(() => {
    expect(['success', 'error']).toContain(
      context.queryClient.getQueryState(
        activeSponsorshipCountQueryOptions(viewer, PRODUCT_HANDLE).queryKey,
      )?.status,
    );
  });
  // 取得の結果を受けた描き直しを終えてから確かめる
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

const notice = () => page.getByText(NOTICE, { exact: true });

const expectNothingDrawn = async () => {
  await expect.element(page.getByText(OTHER_CONTENT)).toBeVisible();
  expect(page.getByTestId('notice-host').element().textContent).toBe('');
  expect(notice().query()).toBeNull();
  expect(page.getByRole('button').elements()).toHaveLength(0);
  expect(page.getByRole('alert').elements()).toHaveLength(0);
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('ProductSponsorshipDeleteNotice', () => {
  test.each([
    ['1件', 1],
    ['複数', 3],
  ])(
    '掲載中・掲載予定の広告が%sあれば、終了し返金されない旨を示す',
    async (_name, count) => {
      respondWithCount(count);
      await renderNotice();

      await expect.element(notice()).toBeVisible();
      expect(countCalls()).toHaveLength(1);
      expect(countCalls()[0]?.[1]).toStrictEqual({
        productHandle: PRODUCT_HANDLE,
      });
    },
  );

  test('掲載中・掲載予定の広告が無ければ何も描かない', async () => {
    respondWithCount(0);
    const context = await renderNotice();

    await waitForSettled(context);
    expect(countCalls()).toHaveLength(1);
    await expectNothingDrawn();
  });

  test('取得に失敗したら、失敗の表示も再試行の操作も出さずに何も描かない', async () => {
    respond(LOAD_FAILURE);
    const context = await renderNotice();

    await waitForSettled(context);
    expect(countCalls()).toHaveLength(1);
    await expectNothingDrawn();
  });

  test('未ログインの閲覧者には取得せず何も描かない', async () => {
    respondWithCount(1);
    await renderNotice(GUEST_VIEWER_QUERY);

    await expectNothingDrawn();
    expect(countCalls()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)('%sの配色で自動検査の違反が無い', async (scheme) => {
    applyColorScheme(scheme);
    respondWithCount(2);
    await renderNotice();
    await expect.element(notice()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
