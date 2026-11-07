import { queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientUltrasOfferDocument,
  ClientViewerUltrasDocument,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const GUEST_SCOPE = 'guest';

// 価格と機能フラグは閲覧者によらないため、共通の取得の補助をそのまま使い、導線を出す複数の部品の取得を1つにまとめる
export const ultrasOfferQueryOptions = () =>
  graphqlQueryOptions(ClientUltrasOfferDocument, {});

// 加入の状態はセッションの利用者のもののため、同じタブでログイン・ログアウトした後に前の利用者の状態を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える。停止中でも自分の加入の状態は同じため、状態はキーに含めない
export const viewerUltrasQueryOptions = (viewer: ClientViewer | null) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientViewerUltrasDocument, {}),
      viewer === null ? GUEST_SCOPE : viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientViewerUltrasDocument, {}, { signal }),
      ),
  });
