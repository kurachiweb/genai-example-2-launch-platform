import { sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { MAX_SEARCH_SOURCE_ID_LENGTH } from '../../core/messaging/contracts/search-index-refresh.ts';
import type { KeywordStatus } from '../../core/search/keyword-status.ts';
import {
  requireSearchTargetDefinition,
  type SearchTargetRegistry,
} from './search-target-definition.ts';

// D1の1文あたりのバインド変数の上限100に、余裕を残して収める
export const MAX_SOURCE_IDS_PER_DELETE_STATEMENT = 90;

const PENDING: KeywordStatus = 'pending';

export interface SearchIndexStatements {
  markPending(target: string, sourceId: string, now: Date): BatchItem<'sqlite'>;
  deleteSources(
    target: string,
    sourceIds: readonly string[],
  ): readonly BatchItem<'sqlite'>[];
}

export function createSearchIndexStatements(
  db: Database,
  registry: SearchTargetRegistry,
): SearchIndexStatements {
  // 索引文書のテーブル名は索引の定義の検証で英小文字・数字・_に限るため、SQLへ直接埋め込む
  const documentsTable = (target: string): SQL =>
    sql.raw(
      requireSearchTargetDefinition(registry, target).index.documentsTableName,
    );

  return {
    // 抽出の入力のハッシュを残し、編集で抽出の対象のテキストが変わらなければ更新の処理が外部APIを呼ばずに前回のキーワードを使えるようにする
    markPending(target, sourceId, now) {
      const documents = documentsTable(target);
      assertSourceId(sourceId);
      return db.run(
        sql`INSERT INTO ${documents} (source_id, source_version, keyword_status, status_changed_at) VALUES (${sourceId}, 0, ${PENDING}, ${now.getTime()}) ON CONFLICT(source_id) DO UPDATE SET keyword_status = excluded.keyword_status, status_changed_at = excluded.status_changed_at`,
      );
    },
    deleteSources(target, sourceIds) {
      const documents = documentsTable(target);
      for (const sourceId of sourceIds) {
        assertSourceId(sourceId);
      }
      return chunksOf(sourceIds, MAX_SOURCE_IDS_PER_DELETE_STATEMENT).map(
        (chunk) =>
          db.run(
            sql`DELETE FROM ${documents} WHERE source_id IN (${sql.join(
              chunk.map((sourceId) => sql`${sourceId}`),
              sql`, `,
            )})`,
          ),
      );
    },
  };
}

// 索引の更新の要求の契約が受け付けない識別子の行は更新されないまま再抽出の候補に残り続けるため、ドメインの一括の書き込みを確定する前に拒否する
function assertSourceId(sourceId: string): void {
  if (sourceId === '' || sourceId.length > MAX_SEARCH_SOURCE_ID_LENGTH) {
    throw new RangeError(
      `元データの識別子は1文字以上${String(MAX_SEARCH_SOURCE_ID_LENGTH)}文字以下にしてください。`,
    );
  }
}

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}
