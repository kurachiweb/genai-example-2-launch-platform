import { LoaderCircleIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { INVALID_LINK_MESSAGE } from './account-messages.ts';
import { isInvalidLinkError } from '../../../lib/utilities/auth/invalid-link.ts';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { useFragmentToken } from '../../../lib/components/auth/use-fragment-token.ts';

export interface LinkConfirmationProps<TResult> {
  readonly description: string;
  readonly actionLabel: string;
  readonly confirm: (token: string) => Promise<TResult>;
  readonly renderSuccess: (result: TResult) => ReactNode;
  readonly invalidLinkGuide: ReactNode;
}

type ConfirmationState<TResult> =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'succeeded'; readonly result: TResult }
  | { readonly status: 'invalid' };

// メールのリンクを開いただけ(メールソフトやセキュリティ製品の事前の取得を含む)では状態を変えないよう、利用者がボタンを押した時だけ確定する
export function LinkConfirmation<TResult>({
  description,
  actionLabel,
  confirm,
  renderSuccess,
  invalidLinkGuide,
}: LinkConfirmationProps<TResult>) {
  const link = useFragmentToken();
  const [state, setState] = useState<ConfirmationState<TResult>>({
    status: 'idle',
  });
  const [failure, setFailure] = useState<string>();

  if (link.status === 'reading') {
    return null;
  }

  if (link.status === 'missing' || state.status === 'invalid') {
    return (
      <ResultNotice tone="error" message={INVALID_LINK_MESSAGE}>
        {invalidLinkGuide}
      </ResultNotice>
    );
  }

  if (state.status === 'succeeded') {
    return renderSuccess(state.result);
  }

  const pending = state.status === 'pending';

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する
  const handleConfirm = async (): Promise<void> => {
    if (pending) {
      return;
    }
    setFailure(undefined);
    setState({ status: 'pending' });
    try {
      const result = await confirm(link.token);
      setState({ status: 'succeeded', result });
    } catch (error) {
      if (isInvalidLinkError(error)) {
        setState({ status: 'invalid' });
        return;
      }
      setFailure(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      setState({ status: 'idle' });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {failure === undefined ? null : (
        <FormMessage role="alert">{failure}</FormMessage>
      )}
      <p className="text-sm text-muted-foreground">{description}</p>
      <Button
        type="button"
        className="self-start"
        aria-busy={pending ? true : undefined}
        aria-disabled={pending ? true : undefined}
        onClick={() => {
          void handleConfirm();
        }}
      >
        {pending ? (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        ) : null}
        {actionLabel}
      </Button>
    </div>
  );
}
