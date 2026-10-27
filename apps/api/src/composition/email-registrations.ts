import type { Newable } from 'inversify';

import type { UserAddressDirectory } from '../../lib/core/email/ports.ts';
import { UnavailableUserAddressDirectory } from '../infrastructure/email/unavailable-user-address-directory.ts';

// 利用者のアカウントを管理する機能が利用者のテーブルを引くクラスへ書き換える。それまでは照会できないとして、利用者に紐づかない抑止記録を削除しない
export const USER_ADDRESS_DIRECTORY: Newable<UserAddressDirectory> =
  UnavailableUserAddressDirectory;
