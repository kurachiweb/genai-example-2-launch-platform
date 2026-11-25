import type { QuarantineReason } from '../../../../common-lib/moderation/moderation-labels.ts';
import type { AdminImageOwnerView } from '../../../graphql/admin-quarantined-images.ts';
import {
  adminImageOwnerLabel,
  type QuarantinedImageOperation,
  SYSTEM_IMAGE_OWNER_LABEL,
  UNREADABLE_USER_LABEL,
  userImageOwnerLabel,
} from '../shared/moderation-messages.ts';

// 非公開化・ユーザー停止の隔離理由は画像の操作で外さず、プロダクトの復元・停止解除でだけ外れるため、その理由だけの画像には削除だけを置く
export const quarantinedImageOperationsOf = (
  reasons: readonly QuarantineReason[],
): readonly QuarantinedImageOperation[] => {
  const automatic = reasons.includes('auto');
  const byAdmin = reasons.includes('admin_action');
  if (reasons.length === 0) {
    return [];
  }
  if (!automatic && !byAdmin) {
    return ['image.delete'];
  }
  return [
    ...(automatic ? (['image.approve', 'image.reject'] as const) : []),
    ...(byAdmin ? (['image.release', 'image.delete'] as const) : []),
  ];
};

export const quarantinedImageOwnerLabel = (
  owner: AdminImageOwnerView | null,
): string => {
  if (owner === null) {
    return SYSTEM_IMAGE_OWNER_LABEL;
  }
  const { kind, nickname, handle } = owner;
  if (nickname === null) {
    return UNREADABLE_USER_LABEL;
  }
  if (kind === 'admin') {
    return adminImageOwnerLabel(nickname);
  }
  return handle === null
    ? UNREADABLE_USER_LABEL
    : userImageOwnerLabel(nickname, handle);
};
