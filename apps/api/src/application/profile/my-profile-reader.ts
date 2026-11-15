import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import { profileError } from './profile-errors.ts';
import { PROFILE_TYPES } from './profile-types.ts';
import type { MyProfileView, ProfileSnapshot, ProfileStore } from './ports.ts';

export interface MyProfileReader {
  read(user: CurrentUser): Promise<MyProfileView>;
}

export const toMyProfileView = (snapshot: ProfileSnapshot): MyProfileView => ({
  nickname: snapshot.nickname,
  handle: snapshot.handle,
  previousHandle: snapshot.previousHandle,
  headline: snapshot.headline,
  bioMarkdown: snapshot.bioMarkdown,
  avatarFileId: snapshot.avatarFileId,
  websites: snapshot.websites,
  suspended: snapshot.suspended,
});

@injectable()
export class StoreMyProfileReader implements MyProfileReader {
  constructor(
    @inject(PROFILE_TYPES.ProfileStore)
    private readonly store: ProfileStore,
  ) {}

  async read(user: CurrentUser): Promise<MyProfileView> {
    const snapshot = await this.store.findSnapshot(user.user.id);
    if (snapshot === undefined) {
      throw profileError('account_unavailable');
    }
    return toMyProfileView(snapshot);
  }
}
