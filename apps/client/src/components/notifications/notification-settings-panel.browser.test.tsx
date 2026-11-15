import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  BOUNCE_MESSAGE,
  NOTIFICATION_TOPIC_LABELS,
  notificationSettings,
  SECTION_DESCRIPTION,
  SUSPENDED_NOTICE,
} from '../../../test/notification-settings-fixtures.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import type { NotificationSettingsFragment } from '../../graphql/generated/graphql.ts';
import { notificationSettingsQueryOptions } from '../../graphql/notification-settings.ts';
import { NotificationSettingsPanel } from './notification-settings-panel.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// 経路のloaderが取得を済ませた状態を描くため、部品から取得の要求を送らない
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const TOPIC_DESCRIPTIONS = [
  '自分のプロダクトのマッチの前日の夜に、対戦相手と開始時刻をお知らせします。',
  '自分のプロダクトのマッチの当日の夜に、結果をお知らせします。勝ち進んだ場合は翌日のマッチの予告もまとめてお送りします。',
  'フォローしているユーザーのプロダクトのマッチが始まったら、その日の分を1通にまとめてお知らせします。',
  'フォローしているユーザーのプロダクトがProduct of the Week・Product of the Yearを受賞したらお知らせします。',
];

// 経路のloaderが取得を済ませた状態を再現するため、通知設定をキャッシュに入れてから描く
const renderPanel = async (
  settings: NotificationSettingsFragment = notificationSettings(),
) => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    notificationSettingsQueryOptions(VIEWER_ID).queryKey,
    settings,
  );
  await renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <main>
        <h1>通知</h1>
        <NotificationSettingsPanel viewerId={VIEWER_ID} />
      </main>
    </DisplayPreferencesProvider>,
    { context, cachedViewer: signedInViewerQuery() },
  );
};

const section = () => page.getByRole('region', { name: '通知メール' });
const switches = () => section().getByRole('switch');

afterEach(() => {
  applyColorScheme('light');
});

describe('NotificationSettingsPanel', () => {
  test('見出し「通知メール」と初期設定ではすべて受け取らない旨の説明の下に、4つの通知種別のスイッチを名称と説明とともに決まった順で並べる', async () => {
    await renderPanel();

    await expect
      .element(section().getByRole('heading', { level: 2 }))
      .toHaveTextContent('通知メール');
    await expect
      .element(section().getByText(SECTION_DESCRIPTION, { exact: true }))
      .toBeVisible();
    const items = switches().elements();
    expect(items).toHaveLength(4);
    for (const [index, label] of NOTIFICATION_TOPIC_LABELS.entries()) {
      const item = switches().nth(index);
      await expect.element(item).toHaveAccessibleName(label);
      await expect
        .element(item)
        .toHaveAccessibleDescription(TOPIC_DESCRIPTIONS[index] ?? '');
      await expect.element(item).toHaveAttribute('aria-checked', 'false');
    }
  });

  test('サーバーの受信可否をそれぞれのスイッチに示す', async () => {
    await renderPanel(
      notificationSettings({
        enabledTopics: ['MATCH_PREVIEW', 'FOLLOWED_USER_AWARD'],
      }),
    );

    await expect
      .element(switches().nth(0))
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(switches().nth(1))
      .toHaveAttribute('aria-checked', 'false');
    await expect
      .element(switches().nth(2))
      .toHaveAttribute('aria-checked', 'false');
    await expect
      .element(switches().nth(3))
      .toHaveAttribute('aria-checked', 'true');
  });

  test('配信の状態の案内をスイッチの上に示し、抑止の間もスイッチを操作できる', async () => {
    await renderPanel(
      notificationSettings({ suppression: { reason: 'BOUNCE', until: null } }),
    );

    const notice = section().getByText(BOUNCE_MESSAGE, { exact: true });
    await expect.element(notice).toBeVisible();
    expect(
      notice.element().compareDocumentPosition(switches().first().element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const item of switches().elements()) {
      expect(item).toBeEnabled();
    }
  });

  test('停止中の利用者には、4つのスイッチを無効にして停止中の案内を示す', async () => {
    await renderPanel(notificationSettings({ editable: false }));

    await expect
      .element(section().getByText(SUSPENDED_NOTICE, { exact: true }))
      .toBeVisible();
    for (const item of switches().elements()) {
      expect(item).toBeDisabled();
    }
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      [
        '受け取る種別がある',
        notificationSettings({ enabledTopics: ['MATCH_RESULT'] }),
      ],
      ['停止中の', notificationSettings({ editable: false })],
    ])(
      '%s区画で、アクセシビリティの検査の違反が0件',
      async (_label, settings) => {
        await renderPanel(settings);

        await expect.element(section()).toBeVisible();
        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
