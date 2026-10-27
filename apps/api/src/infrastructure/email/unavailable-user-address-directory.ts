import { injectable } from 'inversify';

import type {
  UserAddressDirectory,
  UserAddressLookup,
} from '../../../lib/core/email/ports.ts';

@injectable()
export class UnavailableUserAddressDirectory implements UserAddressDirectory {
  findRegistered(): Promise<UserAddressLookup> {
    return Promise.resolve({ kind: 'unavailable' });
  }
}
