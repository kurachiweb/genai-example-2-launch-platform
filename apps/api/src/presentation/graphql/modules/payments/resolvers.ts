import type { GraphQLResolveInfo } from 'graphql';

import type { CheckoutConsentRecorder } from '../../../../application/payments/checkout-consent-recorder.ts';
import type { CheckoutReader } from '../../../../application/payments/checkout-reader.ts';
import type { CheckoutReturnConfirmer } from '../../../../application/payments/checkout-return-confirmer.ts';
import type { CheckoutStarter } from '../../../../application/payments/checkout-starter.ts';
import type { PaymentHistoryReader } from '../../../../application/payments/payment-history-reader.ts';
import { API_PAYMENTS_TYPES } from '../../../../application/payments/payments-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { callerForbiddenError } from './errors.ts';
import {
  CONFIRM_CHECKOUT_RETURN_ARGS,
  PAYMENT_HISTORY_ARGS,
  PURCHASE_ARGS,
} from './inputs.ts';
import { toCheckout, toPaymentRecordConnection } from './mappers.ts';

// 疎通確認の購入はbot判定を求めないが、購入の内容がbot判定を求めたときに使う操作名を画面と揃えて決めておく
export const SMOKE_CHECKOUT_BOT_ACTION = 'payments_smoke_checkout';

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 決済の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証より前に拒否する
function clientOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'client') {
      throw callerForbiddenError();
    }
    return resolve(parent, args, context, info);
  };
}

const starterOf = (context: GraphQLContext): CheckoutStarter =>
  context.resolve<CheckoutStarter>(API_PAYMENTS_TYPES.CheckoutStarter);

const readerOf = (context: GraphQLContext): CheckoutReader =>
  context.resolve<CheckoutReader>(API_PAYMENTS_TYPES.CheckoutReader);

const consentRecorderOf = (context: GraphQLContext): CheckoutConsentRecorder =>
  context.resolve<CheckoutConsentRecorder>(
    API_PAYMENTS_TYPES.CheckoutConsentRecorder,
  );

const returnConfirmerOf = (context: GraphQLContext): CheckoutReturnConfirmer =>
  context.resolve<CheckoutReturnConfirmer>(
    API_PAYMENTS_TYPES.CheckoutReturnConfirmer,
  );

const historyReaderOf = (context: GraphQLContext): PaymentHistoryReader =>
  context.resolve<PaymentHistoryReader>(
    API_PAYMENTS_TYPES.PaymentHistoryReader,
  );

export const paymentsResolvers = {
  Query: {
    checkout: clientOnly(
      withValidatedArgs(
        PURCHASE_ARGS,
        async (_parent: unknown, { purchaseId }, context) =>
          toCheckout(await readerOf(context).read(context.session, purchaseId)),
      ),
    ),
    paymentHistory: clientOnly(
      withValidatedArgs(
        PAYMENT_HISTORY_ARGS,
        async (_parent: unknown, { first, after }, context) =>
          toPaymentRecordConnection(
            await historyReaderOf(context).list(context.session, {
              first,
              after,
            }),
          ),
      ),
    ),
  },
  Mutation: {
    recordCheckoutConsent: clientOnly(
      withValidatedArgs(
        PURCHASE_ARGS,
        async (_parent: unknown, { purchaseId }, context) =>
          toCheckout(
            await consentRecorderOf(context).record(
              context.session,
              purchaseId,
            ),
          ),
      ),
    ),
    confirmCheckoutReturn: clientOnly(
      withValidatedArgs(
        CONFIRM_CHECKOUT_RETURN_ARGS,
        async (_parent: unknown, { sessionId }, context) => {
          const { checkout } = await returnConfirmerOf(context).confirm(
            context.session,
            sessionId,
          );
          return { checkout: toCheckout(checkout) };
        },
      ),
    ),
    // 利用者の状態と回数制限の確認はbot判定のトークンを使う前にユースケースが行う
    startSmokeCheckout: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const { purchaseId } = await starterOf(context).start({
          session: context.session,
          kind: 'payments_smoke',
          targetId: null,
          humanCheck: () => context.assertHuman(SMOKE_CHECKOUT_BOT_ACTION),
        });
        return { purchaseId };
      },
    ),
  },
} satisfies Resolvers;
