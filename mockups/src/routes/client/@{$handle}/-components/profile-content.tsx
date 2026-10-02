import { useState } from 'react';

import { ReportDialog } from '#/components/client/report-dialog';
import type { ReportTarget } from '#/components/client/report-dialog';

import type { ProfileState, ProfileTab } from '../-model/options';
import type { ProfileModel } from '../-model/page-model';
import { ProfileCard } from './profile-card';
import { ProfileTabs } from './profile-tabs';
import { SuspendedBanner } from './suspended-banner';

type Props = {
  model: ProfileModel;
  state: ProfileState;
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  onRequireLogin: () => void;
};

// PCは左に人物情報(ヘッダー・自己紹介・外部リンク)、右にタブの2カラム。モバイルは人物情報の下にタブを置く
export function ProfileContent({
  model,
  state,
  tab,
  onTabChange,
  onRequireLogin,
}: Props) {
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  return (
    <>
      {model.suspended && <SuspendedBanner />}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[22rem_minmax(0,1fr)]">
        <ProfileCard
          model={model}
          onRequireLogin={onRequireLogin}
          onReport={() =>
            setReportTarget({ kind: 'user', label: 'このユーザー' })
          }
        />
        <ProfileTabs
          model={model}
          state={state}
          tab={tab}
          onTabChange={onTabChange}
        />
      </div>
      <ReportDialog
        target={reportTarget}
        isGuest={model.role === 'guest'}
        onClose={() => setReportTarget(null)}
      />
    </>
  );
}
