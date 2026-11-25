import { ContainerModule } from 'inversify';

import {
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
} from '../application/media/file-access-policies.ts';
import { AdminRoleMediaReviewPolicy } from '../application/moderation/admin-role-media-review-policy.ts';

export const MEDIA_REVIEW_POLICY_BINDINGS = new ContainerModule(({ bind }) => {
  bind<AdminMediaReviewPolicy>(FILE_ACCESS_TYPES.AdminMediaReviewPolicy).to(
    AdminRoleMediaReviewPolicy,
  );
});
