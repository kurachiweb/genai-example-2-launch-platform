import { isSameHandle } from '../../../common-lib/handles/handle-rules.ts';
import { useViewer } from '../auth/use-viewer.ts';
import type { FollowButtonSize, FollowState } from './follow-button-types.ts';
import { FollowLoginButton } from './follow-login-button.tsx';
import { FollowToggleButton } from './follow-toggle-button.tsx';
import { FollowUnverifiedButton } from './follow-unverified-button.tsx';

export interface FollowButtonProps {
  readonly target: { readonly handle: string };
  readonly initialFollowing: boolean;
  readonly onChange?: (state: FollowState) => void;
  readonly size?: FollowButtonSize;
  readonly className?: string;
}

const DEFAULT_SIZE: FollowButtonSize = 'sm';

export function FollowButton({
  target,
  initialFollowing,
  onChange,
  size = DEFAULT_SIZE,
  className,
}: FollowButtonProps) {
  const viewer = useViewer();

  if (viewer === null) {
    return <FollowLoginButton size={size} className={className} />;
  }
  if (isSameHandle(viewer.handle, target.handle)) {
    return null;
  }
  if (!viewer.emailVerified) {
    return <FollowUnverifiedButton size={size} className={className} />;
  }
  return (
    <FollowToggleButton
      handle={target.handle}
      initialFollowing={initialFollowing}
      onChange={onChange}
      size={size}
      className={className}
    />
  );
}
