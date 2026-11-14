import type { Newable } from 'inversify';

import type { SenderInfoProvider } from '../../lib/core/email/ports.ts';
import { UnsetSenderInfoProvider } from '../infrastructure/email/sender-info/unset-sender-info-provider.ts';

// 送信者情報を管理する機能が提供元のクラスへ書き換える。それまでは未設定として送信者情報の区画を省く
export const EMAIL_SENDER_INFO_PROVIDER: Newable<SenderInfoProvider> =
  UnsetSenderInfoProvider;
