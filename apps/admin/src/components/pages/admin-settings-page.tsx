import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { ADMIN_SETTINGS_SECTIONS } from '../../composition/admin-settings-sections.ts';
import { AdminSettingsSectionsView } from '../settings/admin-settings-sections-view.tsx';
import {
  SETTINGS_DESCRIPTION,
  SETTINGS_TITLE,
} from '../settings/settings-messages.ts';

export function AdminSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={SETTINGS_TITLE}
        description={SETTINGS_DESCRIPTION}
      />
      <AdminSettingsSectionsView sections={ADMIN_SETTINGS_SECTIONS} />
    </div>
  );
}
