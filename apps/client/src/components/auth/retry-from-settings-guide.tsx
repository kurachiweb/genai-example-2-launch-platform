import { Link } from '@tanstack/react-router';

import {
  ACCOUNT_SETTINGS_LABEL,
  RETRY_FROM_SETTINGS_SUFFIX,
} from './account-messages.ts';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';

export function RetryFromSettingsGuide() {
  return (
    <p>
      <Link to="/settings/account" className={INLINE_LINK_CLASS_NAME}>
        {ACCOUNT_SETTINGS_LABEL}
      </Link>
      {RETRY_FROM_SETTINGS_SUFFIX}
    </p>
  );
}
