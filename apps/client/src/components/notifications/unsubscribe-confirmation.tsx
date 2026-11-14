import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';

import { useFragmentToken } from '../../../lib/components/auth/use-fragment-token.ts';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { isInvalidLinkError } from '../../../lib/utilities/auth/invalid-link.ts';
import { RETRY_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import {
  NOTIFICATION_TOPIC_COPY,
  type NotificationTopic,
} from '../../../common-lib/notifications/notification-topics.ts';
import { ClientConfirmNotificationUnsubscribeDocument } from '../../graphql/generated/graphql.ts';
import { notificationUnsubscribeLinkQueryOptions } from '../../graphql/notification-settings.ts';
import {
  alreadyUnsubscribedMessage,
  INVALID_UNSUBSCRIBE_LINK_MESSAGE,
  OPEN_NOTIFICATION_SETTINGS_LABEL,
  UNSUBSCRIBE_FAILED_MESSAGE,
  UNSUBSCRIBE_SUBMIT_LABEL,
  unsubscribedMessage,
  unsubscribeQuestion,
} from './notification-messages.ts';

const NOTIFICATION_SETTINGS_PATH = '/settings/notifications';

type ConfirmOutcome = 'idle' | 'failed' | 'invalid' | 'done';

interface UnsubscribeActionProps {
  readonly failed: boolean;
  readonly question?: string;
  readonly label: string;
  readonly pending: boolean;
  readonly onAction: () => void;
}

const topicLabelOf = (topic: NotificationTopic): string =>
  NOTIFICATION_TOPIC_COPY[topic].label;

function SettingsLink() {
  return (
    <Link to={NOTIFICATION_SETTINGS_PATH} className={INLINE_LINK_CLASS_NAME}>
      {OPEN_NOTIFICATION_SETTINGS_LABEL}
    </Link>
  );
}

function InvalidLinkNotice() {
  return (
    <ResultNotice tone="error" message={INVALID_UNSUBSCRIBE_LINK_MESSAGE}>
      <SettingsLink />
    </ResultNotice>
  );
}

// 照会の失敗・確認・確定の失敗を同じ部品で描き、表示が入れ替わってもボタンの要素を保ってフォーカスを<body>へ落とさない
function UnsubscribeAction({
  failed,
  question,
  label,
  pending,
  onAction,
}: UnsubscribeActionProps) {
  return (
    <div className="flex flex-col gap-5">
      {failed ? (
        <FormMessage role="alert">{UNSUBSCRIBE_FAILED_MESSAGE}</FormMessage>
      ) : null}
      {question === undefined ? null : <p>{question}</p>}
      <Button
        type="button"
        className="self-start"
        aria-busy={pending ? true : undefined}
        aria-disabled={pending ? true : undefined}
        onClick={onAction}
      >
        {pending ? (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        ) : null}
        {label}
      </Button>
    </div>
  );
}

// メールの安全確認などがリンクを先に開いても停止させないよう、開いた時は照会だけを行い、利用者がボタンを押した時だけ確定する
export function UnsubscribeConfirmation() {
  const link = useFragmentToken();
  const token = link.status === 'found' ? link.token : '';
  const linkQuery = useQuery({
    ...notificationUnsubscribeLinkQueryOptions(token),
    enabled: link.status === 'found',
  });
  const confirmUnsubscribe = useMutation(
    graphqlMutationOptions(ClientConfirmNotificationUnsubscribeDocument),
  );
  const [outcome, setOutcome] = useState<ConfirmOutcome>('idle');

  if (link.status === 'reading') {
    return <LoadingSkeleton />;
  }

  if (link.status === 'missing' || outcome === 'invalid') {
    return <InvalidLinkNotice />;
  }

  const view = linkQuery.data;

  if (view === undefined) {
    if (!linkQuery.isError) {
      return <LoadingSkeleton />;
    }
    const refetching = linkQuery.isFetching;
    return (
      <UnsubscribeAction
        failed
        label={RETRY_LABEL}
        pending={refetching}
        onAction={() => {
          if (refetching) {
            return;
          }
          void linkQuery.refetch();
        }}
      />
    );
  }

  if (view.status === 'invalid') {
    return <InvalidLinkNotice />;
  }

  const topicLabel = topicLabelOf(view.topic);

  if (outcome === 'done') {
    return (
      <ResultNotice tone="success" message={unsubscribedMessage(topicLabel)}>
        <SettingsLink />
      </ResultNotice>
    );
  }

  if (view.status === 'already_disabled') {
    return (
      <ResultNotice
        tone="success"
        message={alreadyUnsubscribedMessage(topicLabel)}
      />
    );
  }

  const pending = confirmUnsubscribe.isPending;
  const failed = outcome === 'failed';

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する
  const handleConfirm = async (): Promise<void> => {
    if (pending) {
      return;
    }
    try {
      await confirmUnsubscribe.mutateAsync({ variables: { token } });
      setOutcome('done');
    } catch (error) {
      setOutcome(isInvalidLinkError(error) ? 'invalid' : 'failed');
    }
  };

  return (
    <UnsubscribeAction
      failed={failed}
      question={unsubscribeQuestion(topicLabel)}
      label={failed ? RETRY_LABEL : UNSUBSCRIBE_SUBMIT_LABEL}
      pending={pending}
      onAction={() => {
        void handleConfirm();
      }}
    />
  );
}
