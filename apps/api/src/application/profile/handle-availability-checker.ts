import { inject, injectable } from 'inversify';

import {
  checkHandleFormat,
  isReservedHandle,
  isSameHandle,
} from '../../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import { PROFILE_TYPES } from './profile-types.ts';
import type { ProfileStore } from './ports.ts';

export type HandleAvailabilityResult = 'available' | 'unavailable' | 'invalid';

export interface HandleAvailabilityChecker {
  check(userId: string, handle: string): Promise<HandleAvailabilityResult>;
}

@injectable()
export class StoreHandleAvailabilityChecker implements HandleAvailabilityChecker {
  constructor(
    @inject(PROFILE_TYPES.ProfileStore)
    private readonly store: ProfileStore,
  ) {}

  async check(
    userId: string,
    handle: string,
  ): Promise<HandleAvailabilityResult> {
    if (checkHandleFormat(handle, USER_HANDLE_RULE) !== 'ok') {
      return 'invalid';
    }
    const own = await this.store.findSnapshot(userId);
    if (
      own !== undefined &&
      [own.handle, own.previousHandle].some(
        (ownHandle) => ownHandle !== null && isSameHandle(ownHandle, handle),
      )
    ) {
      return 'available';
    }
    if (isReservedHandle(handle, USER_HANDLE_RULE)) {
      return 'unavailable';
    }
    const occupied = await this.store.isHandleOccupied(handle, {
      exceptUserId: userId,
    });
    return occupied ? 'unavailable' : 'available';
  }
}
