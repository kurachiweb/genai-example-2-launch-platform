import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { TurnstileTokenController } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ClientRegisterProductDocument } from '../../graphql/generated/graphql.ts';
import { invalidateMyProductQueries } from '../../graphql/my-products.ts';
import { kickoffAtOf } from './business-time.ts';
import { productRegisteredMessageOf } from './product-form-messages.ts';
import type { RegisterProductFormOutput } from './product-form-schema.ts';

const LAUNCH_DATE_UNAVAILABLE_CODE = 'launch_date_unavailable';

export type ProductRegistration = (
  values: RegisterProductFormOutput,
  turnstile: TurnstileTokenController,
) => Promise<void>;

// 選んだ日が締め切りを過ぎるなどで選べなくなっていたら、最新の選べる日を示してから選び直させる。成功したら一覧とローンチ履歴の取得を古いものにし、キックオフの日時を示して自分のプロダクトの一覧へ移す
export function useProductRegistration(): ProductRegistration {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const preferences = useDisplayPreferences();
  const registerProduct = useMutation(
    graphqlMutationOptions(ClientRegisterProductDocument),
  );

  return async (values, turnstile) => {
    const { registerProduct: registered } = await sendWithTurnstile(
      turnstile,
      (turnstileToken) =>
        registerProduct.mutateAsync({
          variables: { input: values },
          turnstileToken,
        }),
    ).catch((error: unknown) => {
      if (
        error instanceof GraphQLClientError &&
        error.code === LAUNCH_DATE_UNAVAILABLE_CODE
      ) {
        void invalidateMyProductQueries(queryClient);
      }
      throw error;
    });
    await invalidateMyProductQueries(queryClient);
    notify.success(
      productRegisteredMessageOf(
        registered.latestLaunch?.kickoffAt ?? kickoffAtOf(values.launchDate),
        preferences,
        new Date(),
      ),
    );
    await navigate({ to: '/my/products' });
  };
}
