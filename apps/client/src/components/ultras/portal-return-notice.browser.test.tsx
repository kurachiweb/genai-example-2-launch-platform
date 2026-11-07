import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientUltrasOfferDocument,
  ClientViewerUltrasDocument,
  type ClientViewerUltrasQuery,
} from '../../graphql/generated/graphql.ts';
import { viewerUltrasQueryOptions } from '../../graphql/ultras.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { PortalReturnNotice } from './portal-return-notice.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const PENDING_MESSAGE = '変更を反映しています。';

const DELAYED_MESSAGE =
  '反映に時間がかかっています。しばらくしてからこのページを開き直してください。';

const RECHECK_MS = 5000;

const RECHECK_LIMIT = 12;

const VIEWER_QUERY = signedInViewerQuery();

const VIEWER: ClientViewer = {
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
};

const ACTIVE_ULTRAS: ClientViewerUltrasQuery = {
  viewerUltras: {
    entitled: true,
    canOpenPortal: true,
    plan: {
      status: 'ACTIVE',
      startedAt: '2026-11-01T00:00:00.000Z',
      currentPeriodEndsAt: '2026-12-01T00:00:00.000Z',
      canceledAt: null,
      benefitEndsAt: null,
    },
  },
};

const CANCELED_ULTRAS: ClientViewerUltrasQuery = {
  viewerUltras: {
    entitled: true,
    canOpenPortal: true,
    plan: {
      status: 'CANCELED',
      startedAt: '2026-11-01T00:00:00.000Z',
      currentPeriodEndsAt: '2026-12-01T00:00:00.000Z',
      canceledAt: '2026-11-10T03:00:00.000Z',
      benefitEndsAt: '2026-12-01T00:00:00.000Z',
    },
  },
};

// 加入状態の照会だけに応え、他の文書の取得は失敗にして取り直しの広がりを見逃さない
const respondWith = (viewerUltras: ClientViewerUltrasQuery) => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientViewerUltrasDocument
      ? Promise.resolve({ ok: true, data: viewerUltras })
      : Promise.reject(new Error('想定外の文書の取得')),
  );
};

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

// ページのloaderが先に取得した状態を再現し、部品の表示では取得せずに取り直しだけを数える
const renderNotice = async () => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    viewerUltrasQueryOptions(VIEWER).queryKey,
    ACTIVE_ULTRAS,
  );
  await renderInRouter(
    <main>
      <PortalReturnNotice viewer={VIEWER} />
    </main>,
    { context, cachedViewer: VIEWER_QUERY },
  );
  return context;
};

const status = () => page.getByRole('status');

// 1回の取り直しが済んでから次の間隔を進め、間隔ごとに1回だけ取り直すことを確かめる
const advanceRechecks = async (count: number): Promise<void> => {
  if (count === 0) {
    return;
  }
  const before = callsOf(ClientViewerUltrasDocument).length;
  await vi.advanceTimersByTimeAsync(RECHECK_MS);
  await expect
    .poll(() => callsOf(ClientViewerUltrasDocument).length)
    .toBe(before + 1);
  await advanceRechecks(count - 1);
};

beforeEach(() => {
  executeGraphQL.mockReset();
  respondWith(ACTIVE_ULTRAS);
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('PortalReturnNotice', () => {
  test('戻った直後は「変更を反映しています。」を状態の文で示し、5秒が過ぎるまで取り直さない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await renderNotice();

    await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);
    expect(executeGraphQL).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RECHECK_MS - 1);
    expect(executeGraphQL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(() => callsOf(ClientViewerUltrasDocument).length).toBe(1);
    await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);
  });

  test('取り直した加入状態が変わっていても反映が済んだとは判定せず、状態の文を変えない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const context = await renderNotice();
    respondWith(CANCELED_ULTRAS);

    await vi.advanceTimersByTimeAsync(RECHECK_MS);

    await expect
      .poll(() =>
        context.queryClient.getQueryData(
          viewerUltrasQueryOptions(VIEWER).queryKey,
        ),
      )
      .toStrictEqual(CANCELED_ULTRAS);
    await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);
  });

  test('加入状態の照会だけを5秒ごとに取り直し、12回で止めて同じ状態の文を開き直しの案内に切り替える', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await renderNotice();
    await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);

    await advanceRechecks(RECHECK_LIMIT - 1);

    await expect
      .poll(() => callsOf(ClientViewerUltrasDocument).length)
      .toBe(RECHECK_LIMIT - 1);
    await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);

    await advanceRechecks(1);

    await expect
      .poll(() => callsOf(ClientViewerUltrasDocument).length)
      .toBe(RECHECK_LIMIT);
    await expect.element(status()).toHaveTextContent(DELAYED_MESSAGE);
    expect(status().elements()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(RECHECK_MS * 3);

    expect(callsOf(ClientViewerUltrasDocument)).toHaveLength(RECHECK_LIMIT);
    expect(callsOf(ClientUltrasOfferDocument)).toHaveLength(0);
    expect(executeGraphQL).toHaveBeenCalledTimes(RECHECK_LIMIT);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('反映待ちの表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderNotice();
      await expect.element(status()).toHaveTextContent(PENDING_MESSAGE);

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
