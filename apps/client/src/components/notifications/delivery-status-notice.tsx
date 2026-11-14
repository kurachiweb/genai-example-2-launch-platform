import { Link } from '@tanstack/react-router';
import {
  InfoIcon,
  type LucideIcon,
  MailWarningIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { cn } from '../../../lib/utilities/class-names.ts';
import type {
  DeliverySuppressionView,
  NotificationSettingsView,
} from '../../graphql/notification-settings.ts';
import {
  CHANGE_EMAIL_LINK_LABEL,
  DELIVERY_STATUS_UNAVAILABLE_MESSAGE,
  EMAIL_UNVERIFIED_NOTICE,
  REJECTED_SUPPRESSION_MESSAGE_PARTS,
  SUPPRESSION_MESSAGES,
  SUSPENDED_NOTIFICATION_SETTINGS_NOTICE,
} from './notification-messages.ts';

type NoticeTone = 'warning' | 'muted' | 'destructive';

const TONE_CLASS_NAMES: Readonly<Record<NoticeTone, string>> = Object.freeze({
  warning: 'border-warning/50 bg-warning/15',
  muted: 'border-border bg-muted/50',
  destructive: 'border-destructive/40 bg-destructive/5',
});

const ICON_CLASS_NAMES: Readonly<Record<NoticeTone, string>> = Object.freeze({
  warning: 'text-warning-strong',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
});

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  readonly tone: NoticeTone;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="note"
      className={cn(
        'flex gap-2 rounded-lg border p-4 text-sm',
        TONE_CLASS_NAMES[tone],
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', ICON_CLASS_NAMES[tone])}
      />
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

function SuppressionMessage({
  suppression,
}: {
  readonly suppression: DeliverySuppressionView;
}) {
  if (suppression.reason !== 'REJECTED') {
    return <p>{SUPPRESSION_MESSAGES[suppression.reason]}</p>;
  }
  return (
    <p>
      {REJECTED_SUPPRESSION_MESSAGE_PARTS.beforeUntil}
      <DateTime value={suppression.until} format="longDateTime" />
      {REJECTED_SUPPRESSION_MESSAGE_PARTS.afterUntil}
    </p>
  );
}

export interface DeliveryStatusNoticeProps {
  readonly settings: NotificationSettingsView;
}

// どの案内を示す間も受信可否の表示と変更は妨げないため、スイッチとは別に状態ごとの案内を並べる
export function DeliveryStatusNotice({ settings }: DeliveryStatusNoticeProps) {
  const { suppression, deliveryStatusAvailable, emailVerified, editable } =
    settings;
  if (
    suppression === null &&
    deliveryStatusAvailable &&
    emailVerified &&
    editable
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {suppression === null ? null : (
        <Notice tone="warning" icon={MailWarningIcon}>
          <SuppressionMessage suppression={suppression} />
          <p>
            <Link to="/settings/account" className={INLINE_LINK_CLASS_NAME}>
              {CHANGE_EMAIL_LINK_LABEL}
            </Link>
          </p>
        </Notice>
      )}
      {deliveryStatusAvailable ? null : (
        <Notice tone="muted" icon={InfoIcon}>
          <p>{DELIVERY_STATUS_UNAVAILABLE_MESSAGE}</p>
        </Notice>
      )}
      {emailVerified ? null : (
        <Notice tone="warning" icon={MailWarningIcon}>
          <p>{EMAIL_UNVERIFIED_NOTICE}</p>
        </Notice>
      )}
      {editable ? null : (
        <Notice tone="destructive" icon={TriangleAlertIcon}>
          <p>{SUSPENDED_NOTIFICATION_SETTINGS_NOTICE}</p>
        </Notice>
      )}
    </div>
  );
}
