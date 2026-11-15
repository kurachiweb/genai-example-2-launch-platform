import type { Newable } from 'inversify';

import type { UserAddressDirectory } from '../../lib/core/email/ports.ts';
import { D1UserAddressDirectory } from '../../lib/workers/identity/d1-user-address-directory.ts';

export const USER_ADDRESS_DIRECTORY: Newable<UserAddressDirectory> =
  D1UserAddressDirectory;
