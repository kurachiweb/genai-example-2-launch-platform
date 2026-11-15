import { inject, injectable } from 'inversify';

import { isReservedHandle } from '../../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import type { HandleAvailability } from '../identity/ports.ts';
import type { ProfileStore } from './ports.ts';
import { PROFILE_TYPES } from './profile-types.ts';

// 登録の一括の書き込みには旧ハンドルの解放を含められないため、他人の旧ハンドルも避ける
@injectable()
export class UserHandleAvailability implements HandleAvailability {
  constructor(
    @inject(PROFILE_TYPES.ProfileStore)
    private readonly store: ProfileStore,
  ) {}

  async isAvailable(handle: string): Promise<boolean> {
    if (isReservedHandle(handle, USER_HANDLE_RULE)) {
      return false;
    }
    return !(await this.store.isHandleOccupied(handle, {
      includePrevious: true,
    }));
  }
}
