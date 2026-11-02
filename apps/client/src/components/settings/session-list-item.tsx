import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  ClientRevokeSessionDocument,
  type ClientMySessionsQuery,
} from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import { LOGGED_OUT_MESSAGE } from '../auth/account-messages.ts';
import { deviceLabelOf } from './device-label.ts';
import { MY_SESSIONS_QUERY_PREFIX } from './my-sessions-query.ts';
import {
  CURRENT_DEVICE_LABEL,
  LAST_USED_AT_LABEL,
  REVOKE_SESSION_LABEL,
  REVOKE_SESSION_PENDING_LABEL,
  SESSION_REVOKED_MESSAGE,
  SIGNED_IN_AT_LABEL,
} from './settings-messages.ts';

export type SessionSummary = ClientMySessionsQuery['mySessions'][number];

export interface SessionListItemProps {
  readonly session: SessionSummary;
  readonly onRevoked: () => void;
}

export function SessionListItem({ session, onRevoked }: SessionListItemProps) {
  const labelId = useId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const revoke = useMutation({
    ...graphqlMutationOptions(ClientRevokeSessionDocument),
    onSuccess: async () => {
      if (session.current) {
        // この端末のCookieも消えたため、ログアウトと同じく利用者を取り直してログイン必須の判定をやり直させる。ログアウトした利用者の端末の一覧は、ログインの画面へ移った後にタブから消す
        notify.success(LOGGED_OUT_MESSAGE);
        await queryClient.invalidateQueries({
          queryKey: viewerQueryOptions().queryKey,
        });
        await router.invalidate();
        queryClient.removeQueries({ queryKey: MY_SESSIONS_QUERY_PREFIX });
        return;
      }
      notify.success(SESSION_REVOKED_MESSAGE);
      await queryClient.invalidateQueries({
        queryKey: MY_SESSIONS_QUERY_PREFIX,
      });
      onRevoked();
    },
    onError: async (error) => {
      notify.error(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      await queryClient.invalidateQueries({
        queryKey: MY_SESSIONS_QUERY_PREFIX,
      });
    },
  });

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span id={labelId} className="min-w-0 wrap-anywhere">
            {deviceLabelOf(session)}
          </span>
          {session.current ? (
            <Badge variant="secondary">{CURRENT_DEVICE_LABEL}</Badge>
          ) : null}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          <dt>{LAST_USED_AT_LABEL}</dt>
          <dd>
            <DateTime value={session.lastUsedAt} format="longDateTime" />
          </dd>
          <dt>{SIGNED_IN_AT_LABEL}</dt>
          <dd>
            <DateTime value={session.createdAt} format="longDateTime" />
          </dd>
        </dl>
      </div>
      <Button
        type="button"
        variant="outline"
        className="self-start sm:self-center"
        aria-describedby={labelId}
        aria-disabled={revoke.isPending || undefined}
        aria-busy={revoke.isPending || undefined}
        onClick={() => {
          if (!revoke.isPending) {
            revoke.mutate({ variables: { id: session.id } });
          }
        }}
      >
        {revoke.isPending ? REVOKE_SESSION_PENDING_LABEL : REVOKE_SESSION_LABEL}
      </Button>
    </li>
  );
}
