import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Switch } from '../../../lib/components/ui/switch/switch.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  NOTIFICATION_TOPIC_COPY,
  type NotificationTopic,
} from '../../../common-lib/notifications/notification-topics.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  ClientUpdateNotificationPreferenceDocument,
  type NotificationSettingsFragment,
} from '../../graphql/generated/graphql.ts';
import {
  notificationSettingsQueryOptions,
  notificationTopicValueOf,
  toNotificationSettingsView,
} from '../../graphql/notification-settings.ts';
import { NOTIFICATION_PREFERENCE_SAVED_MESSAGE } from './notification-messages.ts';

export interface NotificationTopicSwitchProps {
  readonly viewerId: string;
  readonly topic: NotificationTopic;
  readonly enabled: boolean;
  readonly editable: boolean;
}

function useTopicPreference({
  viewerId,
  topic,
  enabled,
  editable,
}: NotificationTopicSwitchProps) {
  const queryClient = useQueryClient();
  const update = useMutation(
    graphqlMutationOptions(ClientUpdateNotificationPreferenceDocument),
  );
  const [pendingTarget, setPendingTarget] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [seenEnabled, setSeenEnabled] = useState(enabled);
  // キャッシュの値がサーバーの値に追いついたら、保存の結果として持っていた値を捨ててキャッシュの値に従う
  if (seenEnabled !== enabled) {
    setSeenEnabled(enabled);
    setConfirmed(null);
  }

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する。失敗した時はキャッシュの値のまま操作の前の状態に戻る
  const change = async (next: boolean): Promise<void> => {
    if (pendingTarget !== null || !editable) {
      return;
    }
    setPendingTarget(next);
    let saved: NotificationSettingsFragment;
    try {
      saved = (
        await update.mutateAsync({
          variables: {
            input: { topic: notificationTopicValueOf(topic), enabled: next },
          },
        })
      ).updateNotificationPreference;
    } catch (error) {
      notify.error(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      return;
    } finally {
      setPendingTarget(null);
    }
    // キャッシュの購読者への通知は後から届くため、それまでの間もサーバーの値を示す
    setConfirmed(
      toNotificationSettingsView(saved).preferences.some(
        (preference) => preference.topic === topic && preference.enabled,
      ),
    );
    queryClient.setQueryData(
      notificationSettingsQueryOptions(viewerId).queryKey,
      saved,
    );
    notify.success(NOTIFICATION_PREFERENCE_SAVED_MESSAGE);
  };

  return {
    checked: pendingTarget ?? confirmed ?? enabled,
    pending: pendingTarget !== null,
    change,
  };
}

// 送信中に`disabled`にするとフォーカスが`<body>`へ落ちるため、`aria-disabled`と`aria-busy`で受け付けないことを伝える。停止中の利用者は変更できないため`disabled`にする
export function NotificationTopicSwitch(props: NotificationTopicSwitchProps) {
  const { checked, pending, change } = useTopicPreference(props);
  const switchId = useId();
  const descriptionId = useId();
  const copy = NOTIFICATION_TOPIC_COPY[props.topic];

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={switchId}>{copy.label}</Label>
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {copy.description}
        </p>
      </div>
      <Switch
        id={switchId}
        className="mt-0.5 aria-busy:cursor-progress"
        checked={checked}
        disabled={!props.editable}
        aria-describedby={descriptionId}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onCheckedChange={(next) => {
          void change(next);
        }}
      />
    </div>
  );
}
