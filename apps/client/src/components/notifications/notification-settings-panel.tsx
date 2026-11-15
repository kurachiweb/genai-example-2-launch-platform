import { useSuspenseQuery } from '@tanstack/react-query';

import {
  notificationSettingsQueryOptions,
  toNotificationSettingsView,
} from '../../graphql/notification-settings.ts';
import { SettingsSection } from '../settings/settings-section.tsx';
import { DeliveryStatusNotice } from './delivery-status-notice.tsx';
import {
  NOTIFICATION_SETTINGS_SECTION_DESCRIPTION,
  NOTIFICATION_SETTINGS_SECTION_TITLE,
} from './notification-messages.ts';
import { NotificationTopicSwitch } from './notification-topic-switch.tsx';

export interface NotificationSettingsPanelProps {
  readonly viewerId: string;
}

export function NotificationSettingsPanel({
  viewerId,
}: NotificationSettingsPanelProps) {
  const { data: settings } = useSuspenseQuery({
    ...notificationSettingsQueryOptions(viewerId),
    select: toNotificationSettingsView,
  });

  return (
    <SettingsSection
      title={NOTIFICATION_SETTINGS_SECTION_TITLE}
      description={NOTIFICATION_SETTINGS_SECTION_DESCRIPTION}
    >
      <DeliveryStatusNotice settings={settings} />
      <ul className="flex flex-col divide-y divide-border">
        {settings.preferences.map(({ topic, enabled }) => (
          <li key={topic} className="py-4 first:pt-0 last:pb-0">
            <NotificationTopicSwitch
              viewerId={viewerId}
              topic={topic}
              enabled={enabled}
              editable={settings.editable}
            />
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
