import { useMutation } from '@tanstack/react-query';
import { useEffect, useId } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { UnavailableNotice } from '../../../lib/components/state/unavailable-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ULTRAS_PORTAL_UNAVAILABLE_REASON } from '../../../common-lib/ultras/portal-texts.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientCreateUltrasPortalSessionDocument } from '../../graphql/generated/graphql.ts';
import {
  PORTAL_BUTTON_DESCRIPTION,
  PORTAL_BUTTON_LABEL,
  PORTAL_BUTTON_PENDING_LABEL,
} from './plan-messages.ts';

export interface PortalButtonProps {
  readonly navigateTo?: (url: string) => void;
}

const PAYMENTS_UNAVAILABLE = 'payments_unavailable';

// Customer Portalは外部のサイトのため、ルーターではなくブラウザの遷移で移る
const assignLocation = (url: string): void => {
  window.location.assign(url);
};

const isPaymentsUnavailable = (error: unknown): boolean =>
  error instanceof GraphQLClientError && error.code === PAYMENTS_UNAVAILABLE;

function PortalFailure({
  error,
  errorId,
}: {
  readonly error: unknown;
  readonly errorId: string;
}) {
  if (isPaymentsUnavailable(error)) {
    return <UnavailableNotice reason={ULTRAS_PORTAL_UNAVAILABLE_REASON} />;
  }
  return (
    <FormMessage id={errorId} role="alert">
      {errorMessageOf(error, CLIENT_PROFILE.contactAvailable)}
    </FormMessage>
  );
}

// Customer Portalへ移った後にブラウザの「戻る」でbfcacheから復元されると移動の成功の状態が残るため、復元の時点で変更の状態を戻して押せるようにする
function useResetOnBfcacheRestore(reset: () => void): void {
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        reset();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [reset]);
}

export function PortalButton({
  navigateTo = assignLocation,
}: PortalButtonProps) {
  const descriptionId = useId();
  const errorId = useId();
  const createSession = useMutation({
    ...graphqlMutationOptions(ClientCreateUltrasPortalSessionDocument),
    onSuccess: ({ createUltrasPortalSession: { url } }) => {
      navigateTo(url);
    },
  });
  useResetOnBfcacheRestore(createSession.reset);
  // 移動先のURLを得た後はページを離れるまで待つだけのため、送信中と同じく押せないままにする
  const pending = createSession.isPending || createSession.isSuccess;
  const failure = pending ? null : createSession.error;
  const describedBy =
    failure === null || isPaymentsUnavailable(failure)
      ? descriptionId
      : `${descriptionId} ${errorId}`;

  return (
    <div className="flex flex-col items-start gap-3">
      <p id={descriptionId} className="text-sm text-muted-foreground">
        {PORTAL_BUTTON_DESCRIPTION}
      </p>
      <Button
        type="button"
        variant="outline"
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        aria-describedby={describedBy}
        onClick={() => {
          if (!pending) {
            createSession.mutate({ variables: {} });
          }
        }}
      >
        {pending ? PORTAL_BUTTON_PENDING_LABEL : PORTAL_BUTTON_LABEL}
      </Button>
      {failure === null ? null : (
        <PortalFailure error={failure} errorId={errorId} />
      )}
    </div>
  );
}
