import { ContainerModule } from 'inversify';

import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
} from '../application/media/uploader-eligibility.ts';
import { AllowAllUploaderEligibility } from '../infrastructure/media/allow-all-uploader-eligibility.ts';

// 利用者の認証が無い間は全ての利用者のアップロードが401で止まるため、全許可でも停止中の利用者がアップロードできる経路は無い
export const UPLOADER_ELIGIBILITY_BINDINGS = new ContainerModule(({ bind }) => {
  bind<UploaderEligibility>(UPLOAD_ACCESS_TYPES.UploaderEligibility).to(
    AllowAllUploaderEligibility,
  );
});
