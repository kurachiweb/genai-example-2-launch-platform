import { useState } from 'react';

import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';

export interface SubmitFailure {
  readonly failure: string | undefined;
  readonly clearFailure: () => void;
  readonly onSubmitError: (error: unknown) => void;
}

// 欄に対応しない失敗(第2要素を送らなかった時の本人確認の詳細を含む)を、フォーム全体の文言として示す
export function useSubmitFailure(): SubmitFailure {
  const [failure, setFailure] = useState<string>();
  return {
    failure,
    clearFailure: () => {
      setFailure(undefined);
    },
    onSubmitError: (error) => {
      setFailure(errorMessageOf(error, ADMIN_PROFILE.contactAvailable));
    },
  };
}
