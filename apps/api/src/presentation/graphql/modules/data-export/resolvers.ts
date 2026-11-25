import type { DataExportReader } from '../../../../application/data-export/data-export-reader.ts';
import type { DataExportRequestService } from '../../../../application/data-export/data-export-request-service.ts';
import { DATA_EXPORT_TYPES } from '../../../../application/data-export/data-export-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { encodeCursor, toConnection } from '../../pagination.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { toDataExport } from './data-export-views.ts';
import { afterIdOf, MY_DATA_EXPORTS_ARGS } from './inputs.ts';
import { clientOnly } from './resolver-support.ts';

const readerOf = (context: GraphQLContext): DataExportReader =>
  context.resolve<DataExportReader>(DATA_EXPORT_TYPES.DataExportReader);

const requestServiceOf = (context: GraphQLContext): DataExportRequestService =>
  context.resolve<DataExportRequestService>(
    DATA_EXPORT_TYPES.DataExportRequestService,
  );

// 停止中の利用者も自分のデータを持ち出せるため、一覧と要求のどちらも利用者の状態では拒否しない。メールアドレスの確認と回数の制限は要求のユースケースが行う
export const dataExportResolvers = {
  Query: {
    myDataExports: clientOnly(
      withValidatedArgs(
        MY_DATA_EXPORTS_ARGS,
        async (_parent: unknown, { first, after }, context) => {
          const views = await readerOf(context).listMine(context.session, {
            first,
            afterId: afterIdOf(after),
          });
          const connection = toConnection(views, first, ({ record }) =>
            encodeCursor({ id: record.id }),
          );
          return {
            pageInfo: connection.pageInfo,
            nodes: connection.nodes.map(toDataExport),
          };
        },
      ),
    ),
  },
  Mutation: {
    requestDataExport: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        toDataExport(await requestServiceOf(context).request(context.session)),
    ),
  },
} satisfies Resolvers;
