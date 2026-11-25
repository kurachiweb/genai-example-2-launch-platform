import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
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
  ClientMyWeekEntryDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { WeekEntryDeleteNotice } from './week-entry-delete-notice.tsx';
import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  CLOSED_AWAITING_ENTRY,
  closedEntryOf,
  ELIMINATED_ENTRY,
  EXEMPT_AWAITING_ENTRY,
  PAID_ENTITLED_ENTRY,
  SERVER_TIME_THREE_DAYS_BEFORE,
  ULTRAS_ENTITLED_ENTRY,
  WEEK_ENTRY_PRODUCT_HANDLE,
  weekEntryOf,
} from './week-entry-fixtures.ts';
import type { WeekEntryPanelView } from './week-entry-model.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const NOTICE =
  'このプロダクトを削除するとWeekトーナメントの参加資格を失います。支払った参加費は自動で全額返金されます。';

const respond = (entry: WeekEntryPanelView | null): void => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientMyWeekEntryDocument
      ? Promise.resolve({ ok: true, data: { myWeekEntry: entry } })
      : Promise.reject(new Error('想定外の文書の取得')),
  );
};

const renderNotice = (viewerQuery: ClientViewerQuery = signedInViewerQuery()) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <main className="bg-background p-4 text-foreground">
        <RecoverableSlot contactAvailable={false}>
          <WeekEntryDeleteNotice productHandle={WEEK_ENTRY_PRODUCT_HANDLE} />
        </RecoverableSlot>
        <p>削除の確認</p>
      </main>
    </DisplayPreferencesProvider>,
    { cachedViewer: viewerQuery },
  );

const entryCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMyWeekEntryDocument,
  );

const notice = () => page.getByText(NOTICE, { exact: true });

beforeEach(() => {
  executeGraphQL.mockReset();
  vi.useFakeTimers({
    now: new Date(SERVER_TIME_THREE_DAYS_BEFORE),
    toFake: ['Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('WeekEntryDeleteNotice', () => {
  test.each([
    ['受付期限より前の支払い待ち', weekEntryOf()],
    ['受付期限の後で組み合わせ決定の前の支払い待ち', CLOSED_AWAITING_ENTRY],
    ['Ultrasの特典で免除される支払い待ち', EXEMPT_AWAITING_ENTRY],
    ['決済で参加資格を得た枠', PAID_ENTITLED_ENTRY],
    ['Ultrasの特典で参加資格を得た枠', ULTRAS_ENTITLED_ENTRY],
  ])(
    '%sは、削除すると参加資格を失い参加費が全額返金される旨を示す',
    async (_name, entry) => {
      respond(entry);
      await renderNotice();

      await expect.element(notice()).toBeVisible();
      expect(entryCalls()[0]?.[1]).toStrictEqual({
        productHandle: WEEK_ENTRY_PRODUCT_HANDLE,
      });
    },
  );

  test.each([
    ['枠が無い', null],
    ['組み合わせに入った枠', ALIVE_ENTRY],
    ['敗退した枠', ELIMINATED_ENTRY],
    ['優勝した枠', CHAMPION_ENTRY],
    ['期限切れの枠', closedEntryOf('EXPIRED', 'DEADLINE')],
    ['喪失した枠', closedEntryOf('FORFEITED', 'DELETED')],
    ['除外された枠', closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED')],
  ])('%sは何も示さない', async (_name, entry) => {
    respond(entry);
    await renderNotice();

    await expect.poll(() => entryCalls().length).toBe(1);
    await expect
      .poll(() => page.getByRole('main').element().firstElementChild?.innerHTML)
      .toBe('');
    expect(notice().query()).toBeNull();
  });

  test('未ログインの閲覧者には取得せず何も示さない', async () => {
    respond(weekEntryOf());
    await renderNotice(GUEST_VIEWER_QUERY);

    await expect.element(page.getByText('削除の確認')).toBeVisible();
    expect(notice().query()).toBeNull();
    expect(entryCalls()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)('%sの配色で自動検査の違反が無い', async (scheme) => {
    applyColorScheme(scheme);
    respond(PAID_ENTITLED_ENTRY);
    await renderNotice();
    await expect.element(notice()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
