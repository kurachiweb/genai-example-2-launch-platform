import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { ClientMyYearEntryDocument } from '../../graphql/generated/graphql.ts';
import type { MyProductSectionContext } from '../product/product-section-types.ts';
import type { ProductOwnerActionContext } from '../product-page/product-page-section-types.ts';
import {
  SERVER_TIME_THREE_DAYS_BEFORE,
  serverTimeBeforeAcceptUntil,
  YEAR_ENTRY_ACCEPT_UNTIL,
  YEAR_ENTRY_PRODUCT_HANDLE,
  yearEntryOf,
} from './year-entry-fixtures.ts';
import { YearEntryMyProductSection } from './year-entry-my-product-section.tsx';
import { YearEntryOwnerAction } from './year-entry-owner-action.tsx';
import type { YearEntryPanelView } from './year-entry-view.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKYO_JA = { timeZone: 'Asia/Tokyo', locale: 'ja-JP' } as const;

const HOUR_MS = 3_600_000;

const BUTTON_NAME = /^Yearトーナメントに参加/u;

const URGENT_ENTRY = yearEntryOf({
  serverTime: serverTimeBeforeAcceptUntil(HOUR_MS),
});

const respond = (entry: YearEntryPanelView | null): void => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientMyYearEntryDocument
      ? Promise.resolve({ ok: true, data: { myYearEntry: entry } })
      : Promise.reject(new Error('想定外の文書の取得')),
  );
};

const ownerContextOf = (
  overrides: Partial<ProductOwnerActionContext> = {},
): ProductOwnerActionContext => ({
  product: {
    id: '01JD0PR0DVCT00000000000001',
    handle: YEAR_ENTRY_PRODUCT_HANDLE,
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
  productHandle: YEAR_ENTRY_PRODUCT_HANDLE,
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
  page.getByRole('group', { name: 'Product of the Yearトーナメント' });
const entryButton = () => page.getByRole('button', { name: BUTTON_NAME });
const timer = () => page.getByRole('timer', { name: '決済期限までの残り時間' });

const entryCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMyYearEntryDocument,
  );

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

describe('YearEntryOwnerAction', () => {
  test('プロダクト詳細の現在のハンドルの参加費の導線を描く', async () => {
    respond(yearEntryOf());
    await renderSlot(<YearEntryOwnerAction {...ownerContextOf()} />);

    await expect.element(panel()).toBeVisible();
    await expect.element(entryButton()).toBeVisible();
    expect(entryCalls()[0]?.[1]).toStrictEqual({
      productHandle: YEAR_ENTRY_PRODUCT_HANDLE,
    });
  });

  test('ページの自動更新がオンで受付期限まで48時間未満でも秒読みを描かず、自動更新中を申告しない', async () => {
    respond(URGENT_ENTRY);
    const report = vi.fn();
    await renderSlot(
      <YearEntryOwnerAction
        {...ownerContextOf({ reportAutoUpdating: report })}
      />,
    );

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
    expect(report).not.toHaveBeenCalledWith(true);
  });
});

describe('YearEntryMyProductSection', () => {
  test.each(['list', 'edit'] as const)(
    '%sの位置でも参加費の導線を描く',
    async (placement) => {
      respond(yearEntryOf());
      await renderSlot(
        <YearEntryMyProductSection product={{ ...MY_PRODUCT, placement }} />,
      );

      await expect.element(panel()).toBeVisible();
      await expect.element(entryButton()).toBeVisible();
      expect(deadlineTime()?.dateTime).toBe(YEAR_ENTRY_ACCEPT_UNTIL);
      expect(entryCalls()[0]?.[1]).toStrictEqual({
        productHandle: YEAR_ENTRY_PRODUCT_HANDLE,
      });
    },
  );

  test('受付期限まで48時間未満でも秒読みを描かない', async () => {
    respond(URGENT_ENTRY);
    await renderSlot(<YearEntryMyProductSection product={MY_PRODUCT} />);

    await expect.element(entryButton()).toBeVisible();
    expect(timer().query()).toBeNull();
  });

  test('枠が無ければ何も描かない', async () => {
    respond(null);
    await renderSlot(<YearEntryMyProductSection product={MY_PRODUCT} />);

    await expect.poll(() => entryCalls().length).toBe(1);
    await expect
      .poll(() => page.getByRole('main').element().firstElementChild?.innerHTML)
      .toBe('');
  });

  test('自動検査の違反が無い', async () => {
    respond(yearEntryOf());
    await renderSlot(<YearEntryMyProductSection product={MY_PRODUCT} />);
    await expect.element(entryButton()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
