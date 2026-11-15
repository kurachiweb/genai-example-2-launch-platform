import { createFileRoute } from '@tanstack/react-router';

import { NOTIFICATION_SETTINGS_PAGE_TITLE } from '../../../components/notifications/notification-messages.ts';
import { NotificationSettingsPanel } from '../../../components/notifications/notification-settings-panel.tsx';
import { loadNotificationSettings } from '../../../graphql/notification-settings.ts';
import { buildSitePageHead } from '../../../head/page-heads.ts';

// 設定の経路のレイアウトがSettingsShellで包むため、ここでは包み直さない。本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/settings/notifications')({
  loader: loadNotificationSettings,
  head: () =>
    buildSitePageHead({
      title: NOTIFICATION_SETTINGS_PAGE_TITLE,
      noIndex: true,
    }),
  component: NotificationSettingsRoute,
});

function NotificationSettingsRoute() {
  const { viewer } = Route.useRouteContext();
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
        {NOTIFICATION_SETTINGS_PAGE_TITLE}
      </h1>
      <NotificationSettingsPanel viewerId={viewer.id} />
    </>
  );
}
