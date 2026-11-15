import { sql, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { SEARCH_TYPES } from '../../core/search/identifiers.ts';
import type { KeywordStatus } from '../../core/search/keyword-status.ts';
import type {
  IndexWrite,
  SearchIndexStore,
  StoredIndexState,
} from '../../core/search/ports.ts';
import {
  requireSearchTargetDefinition,
  type SearchTargetDefinition,
  type SearchTargetRegistry,
} from './search-target-definition.ts';

interface StoredStateRow {
  readonly source_version: number;
  readonly keyword_status: KeywordStatus;
  readonly extraction_input_hash: string | null;
}

// 列名と索引文書のテーブル名は索引の定義の検証で英小文字・数字・_に限るため、SQLへ直接埋め込む
const identifier = (name: string): SQL => sql.raw(name);

const STATUS_COLUMNS = [
  'source_version',
  'keyword_status',
  'extraction_input_hash',
  'status_changed_at',
] as const;

@injectable()
export class D1SearchIndexRepository implements SearchIndexStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SEARCH_TYPES.TargetCatalog)
    private readonly registry: SearchTargetRegistry,
  ) {}

  async findState(
    target: string,
    sourceId: string,
  ): Promise<StoredIndexState | undefined> {
    const documents = this.documentsTable(target);
    const row: StoredStateRow | undefined = await this.db.get<StoredStateRow>(
      sql`SELECT source_version, keyword_status, extraction_input_hash FROM ${documents} WHERE source_id = ${sourceId}`,
    );
    return (
      row && {
        sourceVersion: row.source_version,
        keywordStatus: row.keyword_status,
        extractionInputHash: row.extraction_input_hash ?? undefined,
      }
    );
  }

  // 版の比較と元データの存在の確認を1文にし、確認と書き込みの間に起きた新しい版の書き込みや元データの削除を上書きしない
  async upsert(
    target: string,
    sourceId: string,
    write: IndexWrite,
  ): Promise<'written' | 'skipped'> {
    const definition = this.definitionOf(target);
    const documents = identifier(definition.index.documentsTableName);
    const textColumns = definition.index.textColumns.map(({ name }) => name);
    const keywords = write.keywords.kind === 'set' ? write.keywords.value : '';

    const columns = [
      'source_id',
      ...STATUS_COLUMNS,
      'keywords',
      ...textColumns,
    ];
    const values: unknown[] = [
      sourceId,
      write.sourceVersion,
      write.keywordStatus,
      write.extractionInputHash,
      write.statusChangedAt.getTime(),
      keywords,
      ...textColumns.map((name) => textOf(write, name)),
    ];
    const updatedColumns = [
      ...STATUS_COLUMNS,
      ...(write.keywords.kind === 'set' ? ['keywords'] : []),
      ...textColumns,
    ];

    const result = await this.db.run(
      sql`INSERT INTO ${documents} (${identifier(columns.join(', '))}) SELECT ${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )} WHERE EXISTS (${definition.isIndexable(sourceId)}) ON CONFLICT(source_id) DO UPDATE SET ${identifier(
        updatedColumns
          .map((column) => `${column} = excluded.${column}`)
          .join(', '),
      )} WHERE excluded.source_version >= ${documents}.source_version`,
    );
    return result.meta.changes > 0 ? 'written' : 'skipped';
  }

  async delete(target: string, sourceId: string): Promise<void> {
    const documents = this.documentsTable(target);
    await this.db.run(
      sql`DELETE FROM ${documents} WHERE source_id = ${sourceId}`,
    );
  }

  async findSourceIdsForReextraction(
    target: string,
    pendingBefore: Date,
    limit: number,
  ): Promise<readonly string[]> {
    const documents = this.documentsTable(target);
    const rows = await this.db.all<{ source_id: string }>(
      sql`SELECT source_id FROM ${documents} WHERE keyword_status = ${'fallback' satisfies KeywordStatus} OR (keyword_status = ${'pending' satisfies KeywordStatus} AND status_changed_at < ${pendingBefore.getTime()}) ORDER BY status_changed_at, id LIMIT ${limit}`,
    );
    return rows.map((row) => row.source_id);
  }

  private definitionOf(target: string): SearchTargetDefinition {
    return requireSearchTargetDefinition(this.registry, target);
  }

  private documentsTable(target: string): SQL {
    return identifier(this.definitionOf(target).index.documentsTableName);
  }
}

function textOf(write: IndexWrite, column: string): string {
  const text = write.texts[column];
  if (text === undefined) {
    throw new TypeError(
      `索引の書き込みに元テキストの列${column}の値がありません。`,
    );
  }
  return text;
}
