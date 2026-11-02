import { PathLink } from '../navigation/path-link.tsx';
import {
  ACCOUNT_SETTINGS_LABEL,
  RETRY_FROM_SETTINGS_SUFFIX,
} from './account-messages.ts';
import { INLINE_LINK_CLASS_NAME } from './inline-link-class.ts';

const ACCOUNT_SETTINGS_PATH = '/settings/account';

export function RetryFromSettingsGuide() {
  return (
    <p>
      <PathLink href={ACCOUNT_SETTINGS_PATH} className={INLINE_LINK_CLASS_NAME}>
        {ACCOUNT_SETTINGS_LABEL}
      </PathLink>
      {RETRY_FROM_SETTINGS_SUFFIX}
    </p>
  );
}
