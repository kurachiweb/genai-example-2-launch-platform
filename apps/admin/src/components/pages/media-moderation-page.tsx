import { getRouteApi } from '@tanstack/react-router';
import { useRef } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { QuarantineReasonTabs } from '../moderation/media/quarantine-reason-tabs.tsx';
import { QuarantinedImageList } from '../moderation/media/quarantined-image-list.tsx';
import { MODERATION_PAGE_COPY } from '../moderation/shared/moderation-messages.ts';
import {
  quarantinedImageListArgsOf,
  toQuarantinedImageSearch,
} from '../moderation/shared/moderation-search.ts';

const routeApi = getRouteApi('/_authenticated/media-moderation/');

const COPY = MODERATION_PAGE_COPY.mediaModeration;

export function MediaModerationPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { reason } = quarantinedImageListArgsOf(search);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={COPY.title} description={COPY.description} />
      <QuarantineReasonTabs
        reason={reason}
        onReasonChange={(next) => {
          void navigate({
            search: toQuarantinedImageSearch({ reason: next }),
            resetScroll: false,
          });
        }}
        panelRef={panelRef}
      >
        <QuarantinedImageList reason={reason} returnFocusRef={panelRef} />
      </QuarantineReasonTabs>
    </div>
  );
}
