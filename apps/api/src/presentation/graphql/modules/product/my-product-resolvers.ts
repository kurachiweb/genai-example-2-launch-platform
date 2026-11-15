import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import type { MyProductsReader } from '../../../../application/product/my-products-reader.ts';
import type { ProductHandleAvailabilityChecker } from '../../../../application/product/product-handle-availability-checker.ts';
import { PRODUCT_TYPES } from '../../../../application/product/product-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  MY_PRODUCTS_ARGS,
  PRODUCT_HANDLE_AVAILABILITY_ARGS,
} from './inputs.ts';
import {
  handleAvailabilityOf,
  toLaunchDateWindow,
  toMyProduct,
  toProductOwnerStatus,
} from './mappers.ts';
import { accountGuardOf, clientOnly } from './resolver-support.ts';

const readerOf = (context: GraphQLContext): MyProductsReader =>
  context.resolve<MyProductsReader>(PRODUCT_TYPES.MyProductsReader);

const availabilityCheckerOf = (
  context: GraphQLContext,
): ProductHandleAvailabilityChecker =>
  context.resolve<ProductHandleAvailabilityChecker>(
    PRODUCT_TYPES.ProductHandleAvailabilityChecker,
  );

const clockOf = (context: GraphQLContext): Clock =>
  context.resolve<Clock>(PLATFORM_TYPES.Clock);

// 照会の対象はセッションの本人のプロダクトだけで、停止中の本人にも返す。位置は利用者の確認の後に戻し、壊れた位置はinvalid_cursorで拒否する
export const myProductResolvers = {
  Query: {
    myProducts: clientOnly(
      withValidatedArgs(
        MY_PRODUCTS_ARGS,
        async (_parent: unknown, { first, after }, context) => {
          const current = await accountGuardOf(context).requireUser(
            context.session,
          );
          const page = await readerOf(context).list(current, { first, after });
          return {
            nodes: page.nodes.map(toMyProduct),
            pageInfo: {
              hasNextPage: page.hasNextPage,
              endCursor: page.endCursor,
            },
          };
        },
      ),
    ),
    myProduct: clientOnly(
      async (_parent: unknown, { handle }: { handle: string }, context) => {
        const current = await accountGuardOf(context).requireUser(
          context.session,
        );
        const result = await readerOf(context).find(current, handle);
        switch (result.kind) {
          case 'product':
            return toMyProduct(result.product);
          case 'redirect':
            return { handle: result.handle };
          case 'not-found':
            return null;
        }
      },
    ),
    newProductLaunchWindow: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const current = await accountGuardOf(context).requireUser(
          context.session,
        );
        return toLaunchDateWindow(
          readerOf(context).newProductWindow(current, clockOf(context).now()),
        );
      },
    ),
    productHandleAvailability: clientOnly(
      withValidatedArgs(
        PRODUCT_HANDLE_AVAILABILITY_ARGS,
        async (_parent: unknown, { handle, productHandle }, context) => {
          const current = await accountGuardOf(context).requireUser(
            context.session,
          );
          return handleAvailabilityOf(
            await availabilityCheckerOf(context).check(
              current,
              handle,
              productHandle,
            ),
          );
        },
      ),
    ),
    productOwnerStatus: clientOnly(
      async (
        _parent: unknown,
        { productHandle }: { productHandle: string },
        context,
      ) => {
        const current = await accountGuardOf(context).requireUser(
          context.session,
        );
        const status = await readerOf(context).ownerStatus(
          current,
          productHandle,
        );
        return status === null ? null : toProductOwnerStatus(status);
      },
    ),
  },
} satisfies Resolvers;
