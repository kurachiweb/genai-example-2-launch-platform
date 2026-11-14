import { randomBytes } from 'node:crypto';

import { qualifierWindow } from '../../apps/backend-lib/core/match/match-model.ts';
import { parseBusinessDate } from '../../apps/backend-lib/core/time/business-time.ts';
import { DIRECTORY_PAGE_SIZE } from '../../apps/common-lib/directory/directory-query-rules.ts';
import { moveLaunchesToDate } from '../client/match-steps.ts';
import {
  endedQualifierInsertSql,
  endedQualifierLookupSql,
  fixtureId,
  ID_RANDOM_BYTES,
  listedProductsInsertSql,
  parseEndedQualifierLookup,
  planListedProducts,
} from './directory-fixture-sql.ts';
import { executeLocalD1 } from './local-d1.ts';
import { addBusinessDays, businessDateOf } from './scheduled-trigger.ts';

export interface EndedQualifierRequest {
  readonly winnerHandle: string;
  readonly loserHandle: string;
  readonly supporterHandle: string;
}

export interface EndedQualifier {
  readonly matchId: string;
  readonly businessDate: string;
}

export interface ListedProductsRequest {
  readonly count?: number;
  readonly matchDate?: string;
}

export interface ListedProduct {
  readonly handle: string;
  readonly name: string;
}

export interface ListedProducts {
  readonly ownerHandle: string;
  readonly matchDate: string;
  readonly products: readonly ListedProduct[];
}

// 1ページの件数より1件多く作り、2ページ目ができるようにする
export const LISTED_PRODUCT_COUNT = DIRECTORY_PAGE_SIZE + 1;

const SUFFIX_BYTES = 4;

const nextFixtureId = (): string =>
  fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES));

// 指定した2つのプロダクトのローンチを当日の予選で対戦させ、終了の日時を過ぎた未確定のマッチにする。ペアリングのジョブは同じカテゴリの他のテストの残りのローンチと組み得るため、マッチはこの補助が作り、確定は呼び出し側が当日の業務日付の23:40の定期実行(triggerScheduled)で起こす
export async function createEndedQualifier(
  request: EndedQualifierRequest,
): Promise<EndedQualifier> {
  const businessDate = businessDateOf(new Date());
  await moveLaunchesToDate(
    [request.winnerHandle, request.loserHandle],
    businessDate,
  );
  const input = { ...request, businessDate };
  const resolved = parseEndedQualifierLookup(
    await executeLocalD1(endedQualifierLookupSql(input)),
    input,
  );
  const ids = {
    matchId: nextFixtureId(),
    winnerEntryId: nextFixtureId(),
    loserEntryId: nextFixtureId(),
    upvoteId: nextFixtureId(),
  };
  const inserted = await executeLocalD1(
    endedQualifierInsertSql(resolved, {
      businessDate,
      window: qualifierWindow(parseBusinessDate(businessDate)),
      now: new Date(),
      ids,
    }),
  );
  if (inserted.length !== 1) {
    throw new Error(
      `予選のマッチ(${ids.matchId})のサポーターのUpvoteを記録できませんでした`,
    );
  }
  return { matchId: ids.matchId, businessDate };
}

// 一覧とページの移動のために、可視の投稿者1人の掲載中のプロダクトを直接作る。予選の確定のイベントを処理済みの形で持たせ、後続の処理を起こさないため、定期実行を起こしても掲載の記録と索引文書は作られず検索には現れない。前回の実行のデータは消さず、ハンドルと名称の乱数の接尾辞で分ける
export async function createListedProducts({
  count = LISTED_PRODUCT_COUNT,
  matchDate = addBusinessDays(businessDateOf(new Date()), -1),
}: ListedProductsRequest = {}): Promise<ListedProducts> {
  const plan = planListedProducts({
    count,
    matchDate,
    window: qualifierWindow(parseBusinessDate(matchDate)),
    now: new Date(),
    suffix: randomBytes(SUFFIX_BYTES).toString('hex'),
    nextId: nextFixtureId,
  });
  const inserted = await executeLocalD1(listedProductsInsertSql(plan));
  if (inserted.length !== count) {
    throw new Error(
      `掲載中のプロダクトを${String(count)}件作る予定が${String(inserted.length)}件でした`,
    );
  }
  return {
    ownerHandle: plan.owner.handle,
    matchDate: plan.matchDate,
    products: plan.products.map(({ handle, name }) => ({ handle, name })),
  };
}
