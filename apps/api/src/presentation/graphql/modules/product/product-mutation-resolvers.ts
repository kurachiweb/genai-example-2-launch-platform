import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import type { ProductDeletion } from '../../../../application/product/product-deletion.ts';
import type { ProductEditor } from '../../../../application/product/product-editor.ts';
import type { ProductRegistration } from '../../../../application/product/product-registration.ts';
import { PRODUCT_TYPES } from '../../../../application/product/product-types.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { INPUT_ARGUMENT } from './errors.ts';
import { REGISTER_PRODUCT_ARGS, UPDATE_PRODUCT_ARGS } from './inputs.ts';
import { toMyProduct } from './mappers.ts';
import {
  accountGuardOf,
  assertHuman,
  clientOnly,
  PRODUCT_BOT_ACTIONS,
} from './resolver-support.ts';

const registrationOf = (context: GraphQLContext): ProductRegistration =>
  context.resolve<ProductRegistration>(PRODUCT_TYPES.ProductRegistration);

const editorOf = (context: GraphQLContext): ProductEditor =>
  context.resolve<ProductEditor>(PRODUCT_TYPES.ProductEditor);

const deletionOf = (context: GraphQLContext): ProductDeletion =>
  context.resolve<ProductDeletion>(PRODUCT_TYPES.ProductDeletion);

// ユースケースはローンチ日を項目と同じ階層の入力で受け取るが、GraphQLの入力ではローンチ日だけが項目(fields)の外にある
const FIELDS_PATH = `${INPUT_ARGUMENT}.fields`;

const inputPathOf = (error: AppError): string =>
  error.code === 'launch_date_unavailable' ? INPUT_ARGUMENT : FIELDS_PATH;

// 保存は入力の検証→利用者の状態の確認→bot判定→ユースケースの順に行い、トークンを使わずに拒否できる要求でトークンを消費させない。
// メールアドレスの確認は登録だけに求め、既存のプロダクトの編集と削除には求めない
export const productMutationResolvers = {
  Mutation: {
    registerProduct: clientOnly(
      withValidatedArgs(
        REGISTER_PRODUCT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await accountGuardOf(context).requireVerifiedUser(
            context.session,
          );
          await assertHuman(context, PRODUCT_BOT_ACTIONS.save);
          const registered = await withInputPath(inputPathOf, () =>
            registrationOf(context).register(current, {
              ...input.fields,
              launchDate: input.launchDate,
            }),
          );
          return toMyProduct(registered);
        },
      ),
    ),
    updateProduct: clientOnly(
      withValidatedArgs(
        UPDATE_PRODUCT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const current = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          await assertHuman(context, PRODUCT_BOT_ACTIONS.save);
          const updated = await withInputPath(inputPathOf, () =>
            editorOf(context).update(current, {
              ...input.fields,
              productHandle: input.productHandle,
              expectedVersion: input.expectedVersion,
              launchDate: input.launchDate,
            }),
          );
          return toMyProduct(updated);
        },
      ),
    ),
    deleteProduct: clientOnly(
      async (
        _parent: unknown,
        args: { productHandle: string; expectedVersion: number },
        context: GraphQLContext,
      ) => {
        const current = await accountGuardOf(context).requireWritableUser(
          context.session,
        );
        await assertHuman(context, PRODUCT_BOT_ACTIONS.delete);
        await deletionOf(context).delete(current, {
          productHandle: args.productHandle,
          expectedVersion: args.expectedVersion,
        });
        return true;
      },
    ),
  },
} satisfies Resolvers;
