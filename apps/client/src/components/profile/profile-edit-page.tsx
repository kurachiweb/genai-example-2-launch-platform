import type { ReactNode } from 'react';

import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { ProfileEditContent } from './profile-edit-content.tsx';
import { PROFILE_EDIT_PAGE_TITLE } from './profile-form-messages.ts';

export interface ProfileEditPageProps {
  readonly viewer: ClientViewer;
}

// 読み込み中と取得の失敗の間も題名を残すため、題名は内容を包む枠として描く。再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする
function ProfileEditPageFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <h1
        tabIndex={-1}
        className="rounded-sm text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {PROFILE_EDIT_PAGE_TITLE}
      </h1>
      {children}
    </div>
  );
}

export function ProfileEditPage({ viewer }: ProfileEditPageProps) {
  return (
    <RecoverableSlot
      className="rounded-sm"
      contactAvailable={CLIENT_PROFILE.contactAvailable}
      contactHref={CONTACT_HREF}
      frame={(content) => (
        <ProfileEditPageFrame>{content}</ProfileEditPageFrame>
      )}
    >
      <ProfileEditPageFrame>
        <ProfileEditContent viewer={viewer} />
      </ProfileEditPageFrame>
    </RecoverableSlot>
  );
}
