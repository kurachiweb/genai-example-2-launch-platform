import { createFileRoute, Outlet } from '@tanstack/react-router';

import { SettingsShell } from '../../../components/settings/settings-shell.tsx';
import { SETTINGS_NAV_ITEMS } from '../../../composition/settings-navigation.ts';

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsRoute,
});

function SettingsRoute() {
  return (
    <SettingsShell items={SETTINGS_NAV_ITEMS}>
      <Outlet />
    </SettingsShell>
  );
}
