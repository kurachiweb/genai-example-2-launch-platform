import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import { ConfirmActionDialog } from '../../../lib/components/admin/confirm-action-dialog.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Switch } from '../../../lib/components/ui/switch/switch.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  type AdminUltrasPromotionSetting,
  adminUltrasPromotionSettingQueryOptions,
  toPromotionLastChange,
} from '../../graphql/admin-ultras-promotion.ts';
import {
  type AdminUltrasPromotionSettingQuery,
  AdminUpdateUltrasPromotionSettingDocument,
  type UpdateUltrasPromotionSettingInput,
} from '../../graphql/generated/graphql.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';
import {
  PROMOTION_NONE_LABEL,
  PROMOTION_READ_ONLY_NOTICE,
  PROMOTION_SETTING_DESCRIPTION,
  PROMOTION_SETTING_TITLE,
  PROMOTION_SWITCH_LABEL,
  PROMOTION_UPDATED_AT_LABEL,
  PROMOTION_UPDATED_BY_LABEL,
  PROMOTION_VERSION_CONFLICT_MESSAGE,
  promotionChangedMessageOf,
  promotionConfirmDescriptionOf,
  promotionConfirmLabelOf,
  promotionConfirmTitleOf,
  promotionStateLabelOf,
} from './promotion-setting-messages.ts';

const VERSION_CONFLICT_CODE = 'version_conflict';

const isVersionConflict = (error: unknown): boolean =>
  error instanceof GraphQLClientError && error.code === VERSION_CONFLICT_CODE;

// 競合は最新を読み直す案内に代え、他の失敗はAPIの文言か問い合わせを促さない固定の文言にする
const failureMessageOf = (error: unknown): string =>
  isVersionConflict(error)
    ? PROMOTION_VERSION_CONFLICT_MESSAGE
    : errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

// 変更の確定。成功した値で照会のキャッシュを置き換え、競合で拒否された時は案内のとおりダイアログを閉じた後に最新の値が見えるよう読み直す
function usePromotionSettingChange() {
  const queryClient = useQueryClient();
  const { queryKey } = adminUltrasPromotionSettingQueryOptions();
  const updateSetting = useMutation(
    graphqlMutationOptions(AdminUpdateUltrasPromotionSettingDocument),
  );
  return async (input: UpdateUltrasPromotionSettingInput): Promise<void> => {
    const { updateUltrasPromotionSetting } = await updateSetting
      .mutateAsync({ variables: { input } })
      .catch(async (error: unknown) => {
        if (isVersionConflict(error)) {
          await queryClient.invalidateQueries({ queryKey });
        }
        throw error;
      });
    queryClient.setQueryData<AdminUltrasPromotionSettingQuery>(queryKey, {
      ultrasPromotionSetting: updateUltrasPromotionSetting,
    });
    notify.success(promotionChangedMessageOf(input.enabled));
  };
}

interface PromotionLastChangeListProps {
  readonly setting: AdminUltrasPromotionSetting;
}

function PromotionLastChangeList({ setting }: PromotionLastChangeListProps) {
  const { updatedAt, updatedByNickname } = toPromotionLastChange(setting);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{PROMOTION_UPDATED_AT_LABEL}</dt>
      <dd>
        {updatedAt === null ? (
          PROMOTION_NONE_LABEL
        ) : (
          <DateTime value={updatedAt} format="longDateTime" />
        )}
      </dd>
      <dt className="text-muted-foreground">{PROMOTION_UPDATED_BY_LABEL}</dt>
      <dd>{updatedByNickname ?? PROMOTION_NONE_LABEL}</dd>
    </dl>
  );
}

interface PromotionSwitchProps {
  readonly enabled: boolean;
  readonly canEdit: boolean;
  readonly onToggle: (next: boolean) => void;
}

// スイッチは確定の前に切り替わらないよう表示中の値に固定し、押下は確認のダイアログを開くだけにする。ロールは表示中に変わらないため、参照だけの管理者にはdisabledで押せないことを伝える
function PromotionSwitch({ enabled, canEdit, onToggle }: PromotionSwitchProps) {
  const switchId = useId();
  const noticeId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          id={switchId}
          checked={enabled}
          disabled={!canEdit}
          aria-describedby={canEdit ? undefined : noticeId}
          onCheckedChange={onToggle}
        />
        <Label htmlFor={switchId}>{PROMOTION_SWITCH_LABEL}</Label>
        <span className="text-sm font-semibold">
          {promotionStateLabelOf(enabled)}
        </span>
      </div>
      {canEdit ? null : (
        <p id={noticeId} className="text-sm text-muted-foreground">
          {PROMOTION_READ_ONLY_NOTICE}
        </p>
      )}
    </div>
  );
}

interface PromotionSettingControlsProps {
  readonly setting: AdminUltrasPromotionSetting;
  readonly canEdit: boolean;
}

function PromotionSettingControls({
  setting,
  canEdit,
}: PromotionSettingControlsProps) {
  const changeSetting = usePromotionSettingChange();
  // 確認のダイアログを開いている間の切り替え後の値。閉じている間はundefined
  const [next, setNext] = useState<boolean>();
  const pendingEnabled = next ?? !setting.enabled;
  return (
    <>
      <PromotionSwitch
        enabled={setting.enabled}
        canEdit={canEdit}
        onToggle={setNext}
      />
      <PromotionLastChangeList setting={setting} />
      <ConfirmActionDialog
        open={next !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setNext(undefined);
          }
        }}
        title={promotionConfirmTitleOf(pendingEnabled)}
        description={promotionConfirmDescriptionOf(pendingEnabled)}
        confirmLabel={promotionConfirmLabelOf(pendingEnabled)}
        reason="optional"
        audited
        onConfirm={({ reason }) =>
          changeSetting({
            enabled: pendingEnabled,
            expectedVersion: setting.version,
            reason,
          })
        }
        failureMessageOf={failureMessageOf}
      />
    </>
  );
}

// 設定のページの機能フラグの区画。最上位管理者だけが切り替えられ、他のロールは参照だけにする
export function PromotionSettingSection() {
  const headingId = useId();
  const canEdit = hasRole(useAdminRole(), 'super_admin');
  const { data } = useQuery({
    ...adminUltrasPromotionSettingQueryOptions(),
    // 設定が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の値を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  const setting = data?.ultrasPromotionSetting;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {PROMOTION_SETTING_TITLE}
      </h2>
      <p className="text-sm text-muted-foreground">
        {PROMOTION_SETTING_DESCRIPTION}
      </p>
      {setting === undefined ? (
        <LoadingSkeleton />
      ) : (
        <PromotionSettingControls setting={setting} canEdit={canEdit} />
      )}
    </section>
  );
}
