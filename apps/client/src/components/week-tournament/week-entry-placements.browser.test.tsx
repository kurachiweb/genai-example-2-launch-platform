import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import { tokenColorOf } from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientMyWeekEntryDocument,
  ClientUltrasOfferDocument,
} from '../../graphql/generated/graphql.ts';
import type { MyProductSectionContext } from '../product/product-section-types.ts';
import type { ProductOwnerActionContext } from '../product-page/product-page-section-types.ts';
import {
  SERVER_TIME_THREE_DAYS_BEFORE,
  serverTimeBeforeAcceptUntil,
  WEEK_ENTRY_ACCEPT_UNTIL,
  WEEK_ENTRY_PRODUCT_HANDLE,
  weekEntryOf,
} from './week-entry-fixtures.ts';
import type { WeekEntryPanelView } from './week-entry-model.ts';
import { WeekEntryMyProductSection } from './week-entry-my-product-section.tsx';
import { WeekEntryOwnerAction } from './week-entry-owner-action.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA = { timeZone: 'Asia/Tokyo', locale: 'ja-JP' } as const;

const HOUR_MS = 3_600_000;

const BUTTON_NAME = /^Weekトーナメントに参加/u;

const URGENT_ENTRY = weekEntryOf({
  serverTime: serverTimeBeforeAcceptUntil(HOUR_MS),
});

const respond = (entry: WeekEntryPanelView | null): void => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientMyWeekEntryDocument) {
      return Promise.resolve({ ok: true, data: { myWeekEntry: entry } });
    }
    if (document === ClientUltrasOfferDocument) {
      return Promise.resolve({
        ok: true,
        data: {
          ultrasOffer: {
            price: { amount: 999, currency: 'usd' },
            priceStale: false,
            promotionEnabled: true,
          },
        },
      });
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const ownerContextOf = (
  overrides: Partial<ProductOwnerActionContext> = {},
): ProductOwnerActionContext => ({
  product: {
    id: '01JD0PR0DVCT00000000000001',
    handle: WEEK_ENTRY_PRODUCT_HANDLE,
    name: 'Pitch Deck',
    listed: true,
    ownerHandle: 'pitch_maker',
  },
  viewer: { signedIn: true, isOwner: true },
  autoRefresh: true,
  reportAutoUpdating: () => undefined,
  ...overrides,
});

const MY_PRODUCT: MyProductSectionContext = {
  productHandle: WEEK_ENTRY_PRODUCT_HANDLE,
  productName: 'Pitch Deck',
  hidden: false,
  placement: 'list',
};

const renderSlot = async (content: ReactNode) => {
  await emulateBrowserDisplay(TOKYO_JA);
  return renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <main>
        <RecoverableSlot contactAvailable={false}>{content}</RecoverableSlot>
      </main>
    </DisplayPreferencesProvider>,
    { cachedViewer: signedInViewerQuery() },
  );
};

const panel = () =>
  page.getByRole('group', { name: 'Product of the Weekトーナメント' });
const entryButton = () => page.getByRole('button', { name: BUTTON_NAME });
const timer = () => page.getByRole('timer', { name: '決済期限までの残り時間' });

const lastReport = (report: ReturnType<typeof vi.fn>): unknown =>
  report.mock.calls.at(-1)?.[0];

const deadlineTime = () =>
  document.querySelector<HTMLTimeElement>('[data-entry-deadline-time] time');

beforeEach(() => {
  executeGraphQL.mockReset();
  vi.useFakeTimers({
    now: new Date(SERVER_TIME_THREE_DAYS_BEFORE),
    toFake: ['Date'],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await emulateBrowserDisplay(null);
});

describe('WeekEntryOwnerAction', () => {
  test('プロダクト詳細の現在のハンドルの参加費の導線を描く', async () => {
    respond(weekEntryOf());
    await renderSlot(<WeekEntryOwnerAction {...ownerContextOf()} />);

    await expect.element(entryButton()).toBeVisible();
    expect(
      executeGraphQL.mock.calls.find(
        ([document]) => document === ClientMyWeekEntryDocument,
      )?.[1],
    ).toStrictEqual({ productHandle: WEEK_ENTRY_PRODUCT_HANDLE });
  });

  test('ページの自動更新がオンなら秒読みを描き、秒読みを持つ間をページへ申告する', async () => {
    respond(URGENT_ENTRY);
    const report = vi.fn();
    await renderSlot(
      <WeekEntryOwnerAction
        {...ownerContextOf({ reportAutoUpdating: report })}
      />,
    );

    await expect.element(timer()).toBeVisible();
    await expect.poll(() => lastReport(report)).toBe(true);
  });

  test('ページの自動更新がオフなら秒読みを描かず、秒読みを持つ間の申告は続ける', async () => {
    respond(URGENT_ENTRY);
    const report = vi.fn();
    await renderSlot(
      <WeekEntryOwnerAction
        {...ownerContextOf({ autoRefresh: false, reportAutoUpdating: report })}
      />,
    );

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
    await expect.poll(() => lastReport(report)).toBe(true);
  });
});

describe('WeekEntryMyProductSection', () => {
  test.each(['list', 'edit'] as const)(
    '%sの位置でも参加費の導線を描く',
    async (placement) => {
      respond(weekEntryOf());
      await renderSlot(
        <WeekEntryMyProductSection product={{ ...MY_PRODUCT, placement }} />,
      );

      await expect.element(panel()).toBeVisible();
      await expect.element(entryButton()).toBeVisible();
      expect(deadlineTime()?.dateTime).toBe(WEEK_ENTRY_ACCEPT_UNTIL);
    },
  );

  test('自動更新の切り替えが無い画面のため、48時間未満でも秒読みを描かず、受付期限の日時を注意色で示す', async () => {
    respond(URGENT_ENTRY);
    await renderSlot(<WeekEntryMyProductSection product={MY_PRODUCT} />);

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
    const deadline = document.querySelector('[data-entry-deadline-time]');
    expect(deadline === null ? '' : getComputedStyle(deadline).color).toBe(
      tokenColorOf('warning-strong'),
    );
  });

  test('枠が無ければ何も描かない', async () => {
    respond(null);
    await renderSlot(<WeekEntryMyProductSection product={MY_PRODUCT} />);

    await expect
      .poll(
        () =>
          executeGraphQL.mock.calls.filter(
            ([document]) => document === ClientMyWeekEntryDocument,
          ).length,
      )
      .toBe(1);
    await expect
      .poll(() => page.getByRole('main').element().firstElementChild?.innerHTML)
      .toBe('');
  });

  test('自動検査の違反が無い', async () => {
    respond(URGENT_ENTRY);
    await renderSlot(<WeekEntryMyProductSection product={MY_PRODUCT} />);
    await expect.element(entryButton()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
