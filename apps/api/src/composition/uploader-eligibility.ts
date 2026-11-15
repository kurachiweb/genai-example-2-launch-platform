import { ContainerModule } from 'inversify';

import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
} from '../application/media/uploader-eligibility.ts';

// 停止では既存のセッションを消さないため、停止中・退会済みの利用者のアップロードを保存の前に拒否する
export const UPLOADER_ELIGIBILITY_BINDINGS = new ContainerModule(({ bind }) => {
  bind<UploaderEligibility>(UPLOAD_ACCESS_TYPES.UploaderEligibility).toService(
    IDENTITY_TYPES.AccountUploaderEligibility,
  );
});
