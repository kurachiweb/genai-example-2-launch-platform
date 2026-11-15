import { useSuspenseQuery } from '@tanstack/react-query';

import { Link } from '@tanstack/react-router';

import { myProfileQueryOptions } from '../../graphql/my-profile.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { ProfileEditForm } from './profile-edit-form.tsx';
import { VIEW_PUBLIC_PROFILE_LABEL } from './profile-form-messages.ts';
import { useProfileSave } from './use-profile-save.ts';

export interface ProfileEditContentProps {
  readonly viewer: ClientViewer;
}

export function ProfileEditContent({ viewer }: ProfileEditContentProps) {
  const {
    data: { myProfile: profile },
  } = useSuspenseQuery(myProfileQueryOptions(viewer.id));
  const { save, savedHandle, savedCount } = useProfileSave({
    viewerId: viewer.id,
    expectedHandle: profile.handle,
  });

  return (
    <>
      <ProfileEditForm key={savedCount} profile={profile} onSave={save} />
      {savedHandle === undefined ? null : (
        <p>
          <Link
            to="/@{$handle}"
            params={{ handle: savedHandle }}
            className="text-sm font-medium underline underline-offset-4"
          >
            {VIEW_PUBLIC_PROFILE_LABEL}
          </Link>
        </p>
      )}
    </>
  );
}
