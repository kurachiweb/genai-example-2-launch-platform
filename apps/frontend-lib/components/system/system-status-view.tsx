import { CircleAlertIcon, LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../../utilities/class-names.ts';
import {
  API_SERVER_TIME_LABEL,
  API_UNREACHABLE_MESSAGE,
  BROWSER_RESULT_HEADING,
  DATABASE_LABEL,
  DATABASE_REACHABLE_LABEL,
  DATABASE_UNREACHABLE_LABEL,
  RECHECK_GUIDANCE,
  RECHECK_LABEL,
  RECHECKING_LABEL,
  SERVER_RESULT_HEADING,
  SYSTEM_STATUS_TITLE,
} from '../../utilities/messages/system-status-messages.ts';
import {
  isApiUnreachable,
  type SystemStatusResult,
} from '../../utilities/system/system-status-result.ts';
import { DateTime } from '../datetime/date-time.tsx';
import { Button } from '../ui/button/button.tsx';

export interface SystemStatusViewProps extends Omit<
  ComponentProps<'section'>,
  'children'
> {
  readonly server: SystemStatusResult;
  readonly browser?: SystemStatusResult | undefined;
  readonly onRecheck: () => void;
  readonly rechecking: boolean;
}

const PANEL_CLASS_NAME =
  'flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm';

const PANEL_HEADING_CLASS_NAME = 'text-lg font-bold';

function renderResult(result: SystemStatusResult): ReactNode {
  if (!result.ok) {
    return (
      <p className="flex items-start gap-2 text-sm font-bold text-destructive">
        <CircleAlertIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
        />
        {isApiUnreachable(result.error)
          ? API_UNREACHABLE_MESSAGE
          : result.error.message}
      </p>
    );
  }

  const { serverTime, databaseReachable } = result.data;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{API_SERVER_TIME_LABEL}</dt>
      <dd className="font-bold tabular-nums">
        <DateTime value={serverTime} format="longDateTime" />
      </dd>
      <dt className="text-muted-foreground">{DATABASE_LABEL}</dt>
      <dd className={cn('font-bold', !databaseReachable && 'text-destructive')}>
        {databaseReachable
          ? DATABASE_REACHABLE_LABEL
          : DATABASE_UNREACHABLE_LABEL}
      </dd>
    </dl>
  );
}

function renderBrowserResult(
  browser: SystemStatusResult | undefined,
  rechecking: boolean,
): ReactNode {
  if (rechecking) {
    return <p className="text-sm font-bold">{RECHECKING_LABEL}</p>;
  }
  if (browser === undefined) {
    return <p className="text-sm text-muted-foreground">{RECHECK_GUIDANCE}</p>;
  }
  return renderResult(browser);
}

export function SystemStatusView({
  server,
  browser,
  onRecheck,
  rechecking,
  className,
  ...props
}: SystemStatusViewProps) {
  const titleId = useId();
  const serverHeadingId = useId();
  const browserHeadingId = useId();

  // フォーカスのあるボタンをdisabledにするとフォーカスが文書の先頭へ失われるため、再確認中はaria-disabledで示してフォーカスを保ち、重ねての操作はここで止める
  const handleRecheck = () => {
    if (rechecking) {
      return;
    }
    onRecheck();
  };

  return (
    <section
      aria-labelledby={titleId}
      data-slot="system-status-view"
      className={cn(
        'mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12',
        className,
      )}
      {...props}
    >
      <h1 id={titleId} className="text-2xl font-extrabold tracking-tight">
        {SYSTEM_STATUS_TITLE}
      </h1>
      <section aria-labelledby={serverHeadingId} className={PANEL_CLASS_NAME}>
        <h2 id={serverHeadingId} className={PANEL_HEADING_CLASS_NAME}>
          {SERVER_RESULT_HEADING}
        </h2>
        {renderResult(server)}
      </section>
      <section aria-labelledby={browserHeadingId} className={PANEL_CLASS_NAME}>
        <h2 id={browserHeadingId} className={PANEL_HEADING_CLASS_NAME}>
          {BROWSER_RESULT_HEADING}
        </h2>
        <div role="status">{renderBrowserResult(browser, rechecking)}</div>
        <div>
          <Button
            type="button"
            variant="outline"
            aria-disabled={rechecking ? true : undefined}
            aria-busy={rechecking ? true : undefined}
            onClick={handleRecheck}
          >
            {rechecking ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <RotateCwIcon aria-hidden="true" />
            )}
            {rechecking ? RECHECKING_LABEL : RECHECK_LABEL}
          </Button>
        </div>
      </section>
    </section>
  );
}
