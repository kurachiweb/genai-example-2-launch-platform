import { createSerializationAdapter } from '@tanstack/react-router';

import {
  GraphQLClientError,
  type GraphQLClientErrorInit,
} from '../utilities/graphql/graphql-result.ts';

// サーバー側の描画で失敗した取得の例外は、既定の受け渡しでは文言だけの素のErrorになり、ハイドレーションの後に想定内の文言と想定外の固定の文言の出し分けが変わってしまうため、同じクラスに戻す。原因の例外とスタックはサーバーの内部の情報を含み得るため渡さない
export const graphqlClientErrorAdapter = createSerializationAdapter({
  key: 'graphql-client-error',
  test: (value: unknown): value is GraphQLClientError =>
    value instanceof GraphQLClientError,
  toSerializable: ({
    code,
    message,
    status,
    details,
    retryAfterSeconds,
  }: GraphQLClientError) => ({
    code,
    message,
    status,
    details: details?.map(
      ({ field, message: detailMessage, code: detailCode }) => ({
        field,
        message: detailMessage,
        code: detailCode,
      }),
    ),
    retryAfterSeconds,
  }),
  fromSerializable: (init: GraphQLClientErrorInit) =>
    new GraphQLClientError(init),
});
