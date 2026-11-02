import { useState } from 'react';

import type { SubmitErrorContext } from '../../../lib/components/form/app-form.tsx';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { useViewerRefresh } from '../auth/use-viewer-refresh.ts';

const REAUTHENTICATION_FAILED_CODE = 'reauthentication_failed';

const SECOND_FACTOR_FIELD = 'secondFactor';

const isSecondFactorGroup = (field: string): boolean =>
  field === SECOND_FACTOR_FIELD || field.endsWith(`.${SECOND_FACTOR_FIELD}`);

export interface ReauthenticationSubmitError {
  readonly submitError: string | undefined;
  readonly clearSubmitError: () => void;
  readonly onSubmitError: (error: unknown, context: SubmitErrorContext) => void;
}

// 欄に対応しない失敗はフォーム全体の文言で示す。第2要素を求められたのに欄を描いていなかったのは、他の端末で多要素認証を有効にした後の古い利用者の値で描いたためで、取得し直して第2要素の欄を描かせる
export function useReauthenticationSubmitError(): ReauthenticationSubmitError {
  const [submitError, setSubmitError] = useState<string>();
  const refreshViewer = useViewerRefresh();
  return {
    submitError,
    clearSubmitError: () => {
      setSubmitError(undefined);
    },
    onSubmitError: (error, { unmatched }) => {
      setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      if (
        error instanceof GraphQLClientError &&
        error.code === REAUTHENTICATION_FAILED_CODE &&
        unmatched.some(({ field }) => isSecondFactorGroup(field))
      ) {
        void refreshViewer();
      }
    },
  };
}
