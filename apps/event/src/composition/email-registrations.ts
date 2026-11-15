import type { Newable } from 'inversify';

import type { SenderInfoProvider } from '../../lib/core/email/ports.ts';
import { D1SenderInfoProvider } from '../infrastructure/notifications/d1-sender-info-provider.ts';

export const EMAIL_SENDER_INFO_PROVIDER: Newable<SenderInfoProvider> =
  D1SenderInfoProvider;
