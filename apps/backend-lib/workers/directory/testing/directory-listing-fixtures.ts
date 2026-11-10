import { directoryEntries } from '../../../../db/schema/directory/directory-entries.ts';
import { productSearchDocuments } from '../../../../db/schema/directory/product-search-documents.ts';
import type {
  EntryResult,
  MatchDecision,
} from '../../../core/match/match-model.ts';
import { qualifierWindow } from '../../../core/match/match-model.ts';
import { buildIndexDocument } from '../../../core/search/index-document.ts';
import { selectKeywords } from '../../../core/search/keyword-selection.ts';
import { parseBusinessDate } from '../../../core/time/business-time.ts';
import {
  clearMatchTables,
  insertMatches,
} from '../../match/testing/match-fixtures.ts';
import {
  db,
  insertLaunches,
  productIdOf,
  T0,
} from '../../product/testing/product-fixtures.ts';
import { D1SearchIndexRepository } from '../../search/search-index-repository.ts';
import { createSearchTargetRegistry } from '../../search/search-target-definition.ts';
import { PRODUCT_SEARCH_TARGET } from '../../search/targets/product.ts';

const DECISION_DELAY_MS = 60_000;

export interface QualifierSideFixture {
  readonly product: number;
  readonly owner: number;
  // 確定前の側はnull
  readonly result: EntryResult | null;
  readonly upvotes?: number;
}

export interface QualifierFixture {
  readonly match: number;
  readonly date: string;
  readonly decision?: MatchDecision;
  readonly sides: readonly QualifierSideFixture[];
}

// ローンチと側の番号は、マッチの番号から側の位置ごとに決める
export function qualifierLaunchOf(match: number, position = 0): number {
  return match * 10 + position + 1;
}

export function qualifierDecidedAt(date: string): Date {
  return new Date(
    qualifierWindow(parseBusinessDate(date)).endsAt.getTime() +
      DECISION_DELAY_MS,
  );
}

function launchOutcomeOf(result: EntryResult | null): 'won' | 'lost' | null {
  if (result === null) {
    return null;
  }
  return result === 'lost' ? 'lost' : 'won';
}

export async function insertQualifiers(
  fixtures: readonly QualifierFixture[],
): Promise<void> {
  await insertLaunches(
    fixtures.flatMap((fixture) =>
      fixture.sides.map((side, position) => ({
        index: qualifierLaunchOf(fixture.match, position),
        productIndex: side.product,
        columns: {
          launchDate: fixture.date,
          outcome: launchOutcomeOf(side.result),
          decidedAt:
            side.result === null ? null : qualifierDecidedAt(fixture.date),
        },
      })),
    ),
  );
  await insertMatches(
    fixtures.map((fixture) => {
      const window = qualifierWindow(parseBusinessDate(fixture.date));
      const decided = fixture.sides.every((side) => side.result !== null);
      return {
        index: fixture.match,
        columns: {
          matchDate: fixture.date,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          startedAt: window.startsAt,
          decidedAt: decided ? qualifierDecidedAt(fixture.date) : null,
          decision: decided ? (fixture.decision ?? 'votes') : null,
        },
        entries: fixture.sides.map((side, position) => ({
          index: qualifierLaunchOf(fixture.match, position),
          launch: qualifierLaunchOf(fixture.match, position),
          product: side.product,
          owner: side.owner,
          columns: { upvoteCount: side.upvotes ?? 0, result: side.result },
        })),
      };
    }),
  );
}

// 1回の勝利を、相手の無い不戦勝ではなく勝敗の付いた2つの側のマッチとして作る
export function winOf(
  match: number,
  input: {
    readonly product: number;
    readonly owner: number;
    readonly date: string;
    readonly upvotes?: number;
    readonly opponent: number;
  },
): QualifierFixture {
  return {
    match,
    date: input.date,
    sides: [
      {
        product: input.product,
        owner: input.owner,
        result: 'won',
        upvotes: input.upvotes ?? 1,
      },
      { product: input.opponent, owner: input.owner, result: 'lost' },
    ],
  };
}

const productSearchIndexStore = new D1SearchIndexRepository(
  db,
  createSearchTargetRegistry([PRODUCT_SEARCH_TARGET]),
);

const EXTRACTED_ENTITY_TYPE = 'OTHER';

// 索引の更新の処理と同じく検索対象の読み取りから索引文書を組み立てて条件付きで書き込み、外部APIのキーワード抽出の結果だけを固定の値にする
export async function indexProduct(
  productIndex: number,
  extractedKeywords: readonly string[] = [],
): Promise<void> {
  const productId = productIdOf(productIndex);
  const source = await PRODUCT_SEARCH_TARGET.read(db, productId);
  if (source === undefined) {
    throw new Error(
      `プロダクト${String(productIndex)}は掲載中でないため索引文書を作れない`,
    );
  }
  const document = await buildIndexDocument(PRODUCT_SEARCH_TARGET, source);
  const result = await productSearchIndexStore.upsert(
    PRODUCT_SEARCH_TARGET.name,
    productId,
    {
      sourceVersion: document.sourceVersion,
      texts: document.texts,
      keywords: {
        kind: 'set',
        value: selectKeywords(
          extractedKeywords.map((name) => ({
            name,
            type: EXTRACTED_ENTITY_TYPE,
          })),
        ),
      },
      keywordStatus: 'extracted',
      extractionInputHash: document.extractionInputHash,
      statusChangedAt: T0,
    },
  );
  if (result !== 'written') {
    throw new Error(
      `プロダクト${String(productIndex)}の索引文書を書き込めなかった`,
    );
  }
}

// 索引文書はプロダクトを外部キーで参照しないため別に消す。勝利したプロダクトの記録は外部キーでプロダクトを参照するため先に消す
export async function clearDirectoryTables(): Promise<void> {
  await db.delete(productSearchDocuments);
  await db.delete(directoryEntries);
  await clearMatchTables();
}
