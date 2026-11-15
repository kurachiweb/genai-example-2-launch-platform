import { isSameHandle } from '../../../common-lib/handles/handle-rules.ts';

export type HandleChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'case-only'; readonly next: string }
  | {
      readonly kind: 'changed';
      readonly next: string;
      readonly previous: string;
    };

export type AvatarChange =
  | { readonly kind: 'keep' }
  | {
      readonly kind: 'set';
      readonly fileId: string;
      readonly replaced: string | null;
    }
  | { readonly kind: 'remove'; readonly removed: string };

export interface ProfileEditPlan {
  readonly handle: HandleChange;
  readonly avatar: AvatarChange;
}

export interface ProfileEditState {
  readonly handle: string;
  readonly avatarFileId: string | null;
}

const planHandleChange = (current: string, next: string): HandleChange => {
  if (current === next) {
    return { kind: 'none' };
  }
  if (isSameHandle(current, next)) {
    return { kind: 'case-only', next };
  }
  return { kind: 'changed', next, previous: current };
};

const planAvatarChange = (
  current: string | null,
  next: string | null,
): AvatarChange => {
  if (next === null) {
    return current === null
      ? { kind: 'keep' }
      : { kind: 'remove', removed: current };
  }
  return current === next
    ? { kind: 'keep' }
    : { kind: 'set', fileId: next, replaced: current };
};

export const planProfileEdit = (
  current: ProfileEditState,
  input: ProfileEditState,
): ProfileEditPlan => ({
  handle: planHandleChange(current.handle, input.handle),
  avatar: planAvatarChange(current.avatarFileId, input.avatarFileId),
});
