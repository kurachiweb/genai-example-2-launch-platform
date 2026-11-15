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
  CHANGE_EMAIL_LINK,
  COMPLAINT_MESSAGE,
  DELIVERY_STATUS_UNAVAILABLE,
  EMAIL_UNVERIFIED,
  notificationSettings,
  REJECTED_MESSAGE_PATTERN,
  REJECTED_UNTIL,
  SUSPENDED_NOTICE,
} from '../../../test/notification-settings-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { NotificationSettingsFragment } from '../../graphql/generated/graphql.ts';
import { toNotificationSettingsView } from '../../graphql/notification-settings.ts';
import { DeliveryStatusNotice } from './delivery-status-notice.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// 経路のloaderが取得を済ませた状態を描くため、部品から取得の要求を送らない
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

const renderNotice = (settings: NotificationSettingsFragment) =>
  renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <main>
        <h1>通知</h1>
        <DeliveryStatusNotice settings={toNotificationSettingsView(settings)} />
        <p>以上</p>
      </main>
    </DisplayPreferencesProvider>,
    { path: '/settings/notifications' },
  );

const notes = () => page.getByRole('note');

const changeEmailLink = () =>
  page.getByRole('link', { name: CHANGE_EMAIL_LINK });

const ALL_NOTICES = [
  BOUNCE_MESSAGE,
  COMPLAINT_MESSAGE,
  DELIVERY_STATUS_UNAVAILABLE,
  EMAIL_UNVERIFIED,
  SUSPENDED_NOTICE,
];

const expectOnly = async (visible: readonly string[]): Promise<void> => {
  for (const message of visible) {
    await expect
      .element(page.getByText(message, { exact: true }))
      .toBeVisible();
  }
  for (const message of ALL_NOTICES.filter((item) => !visible.includes(item))) {
    expect(page.getByText(message, { exact: true }).query()).toBeNull();
  }
};

afterEach(() => {
  applyColorScheme('light');
});

describe('DeliveryStatusNotice', () => {
  test('配信できる確認済みの利用者には、案内を何も示さない', async () => {
    await renderNotice(notificationSettings());

    await expect.element(page.getByText('以上')).toBeVisible();
    expect(notes().elements()).toHaveLength(0);
    expect(changeEmailLink().query()).toBeNull();
  });

  test.each([
    ['恒久的なバウンス', 'BOUNCE', BOUNCE_MESSAGE],
    ['苦情', 'COMPLAINT', COMPLAINT_MESSAGE],
  ] as const)(
    '%sによる配信停止中は、理由の文言とメールアドレスの変更への導線を示す',
    async (_label, reason, message) => {
      await renderNotice(
        notificationSettings({ suppression: { reason, until: null } }),
      );

      await expectOnly([message]);
      await expect
        .element(changeEmailLink())
        .toHaveAttribute('href', '/settings/account');
    },
  );

  test('受信側の拒否による配信停止中は、除外が解ける日時を`<time datetime>`で閲覧者のタイムゾーンで示し、メールアドレスの変更への導線を示す', async () => {
    await renderNotice(
      notificationSettings({
        suppression: { reason: 'REJECTED', until: REJECTED_UNTIL },
      }),
    );

    const note = notes().filter({ hasText: '受信側で拒否されたため' });
    const message = note.getByText(REJECTED_MESSAGE_PATTERN);
    await expect.element(message).toBeVisible();
    const until = message
      .element()
      .querySelector(`time[datetime="${REJECTED_UNTIL}"]`);
    expect(until).not.toBeNull();
    expect(until?.textContent).not.toBe('');
    await expect
      .element(note.getByRole('link', { name: CHANGE_EMAIL_LINK }))
      .toHaveAttribute('href', '/settings/account');
    await expectOnly([]);
  });

  test('配信の状態を照会できなかった時は、確認できなかった旨だけを示す', async () => {
    await renderNotice(
      notificationSettings({ deliveryStatusAvailable: false }),
    );

    await expectOnly([DELIVERY_STATUS_UNAVAILABLE]);
    expect(changeEmailLink().query()).toBeNull();
  });

  test('メールアドレスが未確認なら、確認が完了するまで届かない旨を示す', async () => {
    await renderNotice(notificationSettings({ emailVerified: false }));

    await expectOnly([EMAIL_UNVERIFIED]);
  });

  test('変更できない停止中の利用者には、停止中のため変更できない旨を示す', async () => {
    await renderNotice(notificationSettings({ editable: false }));

    await expectOnly([SUSPENDED_NOTICE]);
  });

  test('複数の状態が重なれば、抑止・照会の失敗・未確認・停止中の案内を並べて示す', async () => {
    await renderNotice(
      notificationSettings({
        suppression: { reason: 'COMPLAINT', until: null },
        emailVerified: false,
        editable: false,
      }),
    );

    await expectOnly([COMPLAINT_MESSAGE, EMAIL_UNVERIFIED, SUSPENDED_NOTICE]);
    expect(notes().elements()).toHaveLength(3);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      [
        '受信側の拒否・未確認・停止中',
        notificationSettings({
          suppression: { reason: 'REJECTED', until: REJECTED_UNTIL },
          emailVerified: false,
          editable: false,
        }),
      ],
      ['照会の失敗', notificationSettings({ deliveryStatusAvailable: false })],
      [
        '恒久的なバウンス',
        notificationSettings({
          suppression: { reason: 'BOUNCE', until: null },
        }),
      ],
    ])(
      '%sの案内で、アクセシビリティの検査の違反が0件',
      async (_label, settings) => {
        await renderNotice(settings);

        await expect.element(notes().first()).toBeVisible();
        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
