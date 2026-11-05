import type { InquiryContactFormView } from '../../graphql/inquiry-contact.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { GuestInquiryForm } from '../inquiry/guest-inquiry-form.tsx';
import {
  CONTACT_PAGE_LEAD,
  CONTACT_PAGE_TITLE,
} from '../inquiry/inquiry-contact-messages.ts';
import { MemberInquiryForm } from '../inquiry/member-inquiry-form.tsx';
import { SuspendedContactNotice } from '../inquiry/suspended-contact-notice.tsx';

export interface ContactPageProps {
  readonly viewer: ClientViewer | null;
  readonly form: InquiryContactFormView;
}

interface ContactFormProps {
  readonly viewer: ClientViewer | null;
  readonly form: InquiryContactFormView;
}

// 停止中の利用者は未ログインの問い合わせとして送るため、停止していないログイン中の利用者だけにログインのフォームを出す
function ContactForm({ viewer, form }: ContactFormProps) {
  if (viewer === null) {
    return <GuestInquiryForm categories={form.categories} />;
  }
  if (viewer.status === 'SUSPENDED') {
    return (
      <>
        <SuspendedContactNotice />
        <GuestInquiryForm categories={form.categories} />
      </>
    );
  }
  return (
    <MemberInquiryForm
      categories={form.categories}
      composer={form.composer ?? { nickname: viewer.nickname, avatar: null }}
    />
  );
}

export function ContactPage({ viewer, form }: ContactPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {CONTACT_PAGE_TITLE}
        </h1>
        <p className="text-sm text-muted-foreground">{CONTACT_PAGE_LEAD}</p>
      </div>
      <ContactForm viewer={viewer} form={form} />
    </div>
  );
}
