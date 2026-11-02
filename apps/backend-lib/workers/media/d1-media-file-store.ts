import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import {
  type MediaType,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import type { Database } from '../../../db/client.ts';
import { mediaFileQuarantineReasons } from '../../../db/schema/media/media-file-quarantine-reasons.ts';
import { mediaFiles } from '../../../db/schema/media/media-files.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import {
  type MediaFileView,
  type MediaLocation,
  type MediaOwner,
  type ModerationFinding,
  type ModerationStatus,
  QUARANTINE_REASONS,
  type QuarantineReason,
} from '../../core/media/media-file.ts';
import type {
  EraseCandidateQuery,
  MediaFileStore,
  ModerationRecord,
  ModerationRequeueQuery,
  NewMediaFileRecord,
  OwnedImageQuery,
  OwnerIdListInput,
  OwnerRef,
  QuarantinedImage,
  QuarantinedImageList,
  QuarantinedImageListInput,
} from '../../core/media/ports.ts';
import type { Clock } from '../../core/time/clock.ts';

type MediaFileRow = typeof mediaFiles.$inferSelect;

// D1のバインド変数の上限(100)から、識別子以外の条件と更新値に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

// 理由の行は識別子と記録の識別子の2変数を使い、理由と日時の3変数を全行で共有する
const REASON_ROWS_PER_STATEMENT = 45;

const RECORDABLE_STATUSES: readonly ModerationStatus[] = [
  'pending',
  'undetermined',
];

const reasons = mediaFileQuarantineReasons;

const CURSOR_PATTERN = /^(\d{1,15})-([0-9A-HJKMNP-TV-Z]{26})$/u;

interface QuarantineCursor {
  readonly quarantinedAt: number;
  readonly reasonId: string;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function uniqueOf(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function columnNames(columns: readonly SQLiteColumn[]): SQL {
  return sql.join(
    columns.map((column) => sql.identifier(column.name)),
    sql`, `,
  );
}

const REASON_INSERT_COLUMNS = columnNames([
  reasons.id,
  reasons.fileId,
  reasons.reason,
  reasons.createdAt,
  reasons.updatedAt,
]);

// reasonを省くと、理由の種類によらず1つでも持つかを表す
function reasonExists(reason?: QuarantineReason): SQL {
  const sameReason =
    reason === undefined ? sql`` : sql` AND ${reasons.reason} = ${reason}`;
  return sql`EXISTS (SELECT 1 FROM ${reasons} WHERE ${reasons.fileId} = ${mediaFiles.id}${sameReason})`;
}

function ownedBy(owner: OwnerRef): SQL | undefined {
  return and(
    eq(mediaFiles.ownerKind, owner.kind),
    eq(mediaFiles.ownerId, owner.id),
  );
}

function toOwner(row: MediaFileRow): MediaOwner {
  if (row.ownerKind === 'system') {
    return { kind: 'system' };
  }
  if (row.ownerId === null) {
    throw new TypeError(
      `ファイル${row.id}の記録に保有者の識別子がありません。`,
    );
  }
  return { kind: row.ownerKind, id: row.ownerId };
}

// 記録はテキストの文字コードの引数付きで保存するため、画面向けの形では引数を除いた形式にする
function toMediaType(row: MediaFileRow): MediaType {
  const type = parseMediaType(row.contentType);
  if (type === undefined) {
    throw new TypeError(`ファイル${row.id}の記録の形式を解釈できません。`);
  }
  return type;
}

function toView(
  row: MediaFileRow,
  fileReasons: ReadonlySet<QuarantineReason>,
): MediaFileView {
  const quarantineReasons = QUARANTINE_REASONS.filter((reason) =>
    fileReasons.has(reason),
  );
  return {
    id: row.id,
    objectKey: row.objectKey,
    purpose: row.purpose,
    storage: row.storage,
    location: row.location,
    owner: toOwner(row),
    originalFileName: row.originalFileName,
    contentType: toMediaType(row),
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    stored: row.storedAt !== null,
    attached: row.attachedAt !== null,
    deletedAt: row.deletedAt,
    eraseRequested: row.eraseRequestedAt !== null,
    moderationStatus: row.moderationStatus,
    quarantineReasons,
    quarantined: quarantineReasons.length > 0,
    createdAt: row.createdAt,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isModerationFinding(value: unknown): value is ModerationFinding {
  if (!isRecord(value)) {
    return false;
  }
  switch (value['source']) {
    case 'labels': {
      return (
        typeof value['category'] === 'string' &&
        typeof value['label'] === 'string' &&
        typeof value['confidence'] === 'number'
      );
    }
    case 'svg': {
      return (
        typeof value['violation'] === 'string' &&
        typeof value['target'] === 'string'
      );
    }
    case 'unprocessable': {
      return (
        value['reason'] === 'undecodable' ||
        value['reason'] === 'rejected-by-service'
      );
    }
    default: {
      return false;
    }
  }
}

// moderation_detailは要素の型を持たないJSONの列のため、読み出す時に検出内容の形のものだけを残す
export function toModerationFindings(
  detail: unknown,
): readonly ModerationFinding[] {
  return Array.isArray(detail) ? detail.filter(isModerationFinding) : [];
}

function invalidCursor(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'invalid_cursor',
    message: 'ページの位置の指定が正しくありません。',
  });
}

function encodeCursor(position: QuarantineCursor): string {
  return `${String(position.quarantinedAt)}-${position.reasonId}`;
}

function decodeCursor(cursor: string): QuarantineCursor {
  const match = CURSOR_PATTERN.exec(cursor);
  const [, quarantinedAt, reasonId] = match ?? [];
  if (quarantinedAt === undefined || reasonId === undefined) {
    throw invalidCursor();
  }
  return { quarantinedAt: Number(quarantinedAt), reasonId };
}

function afterCursor(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const position = decodeCursor(cursor);
  const at = new Date(position.quarantinedAt);
  return or(
    lt(reasons.createdAt, at),
    and(eq(reasons.createdAt, at), lt(reasons.id, position.reasonId)),
  );
}

@injectable()
export class D1MediaFileStore implements MediaFileStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async insertReceiving(record: NewMediaFileRecord): Promise<void> {
    const now = this.clock.now();
    await this.db.insert(mediaFiles).values({
      id: record.id,
      objectKey: record.objectKey,
      purpose: record.purpose,
      storage: record.storage,
      location: record.storage,
      ownerKind: record.owner.kind,
      ownerId: record.owner.kind === 'system' ? null : record.owner.id,
      originalFileName: record.originalFileName,
      contentType: record.contentType,
      byteSize: record.byteSize,
      width: record.width,
      height: record.height,
      moderationStatus: record.moderationStatus,
      createdAt: now,
      updatedAt: now,
    });
  }

  async markStored(id: string): Promise<void> {
    const now = this.clock.now();
    await this.db
      .update(mediaFiles)
      .set({ storedAt: now, updatedAt: now })
      .where(and(eq(mediaFiles.id, id), isNull(mediaFiles.storedAt)));
  }

  // 記録と理由を1文で読み、記録と理由の食い違った組み合わせを返さない
  async findViews(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, MediaFileView>> {
    const pages = await Promise.all(
      chunk(uniqueOf(ids), IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({ file: mediaFiles, reason: reasons.reason })
          .from(mediaFiles)
          .leftJoin(reasons, eq(reasons.fileId, mediaFiles.id))
          .where(inArray(mediaFiles.id, page)),
      ),
    );
    const grouped = new Map<
      string,
      { row: MediaFileRow; reasons: Set<QuarantineReason> }
    >();
    for (const { file, reason } of pages.flat()) {
      const entry = grouped.get(file.id) ?? { row: file, reasons: new Set() };
      if (reason !== null) {
        entry.reasons.add(reason);
      }
      grouped.set(file.id, entry);
    }
    return new Map(
      [...grouped].map(([id, entry]) => [id, toView(entry.row, entry.reasons)]),
    );
  }

  // 1件でも紐付けられなければ全件を紐付けない条件は、分割した文の間で互いを参照できないため、識別子の一覧をJSONの1つのバインド変数で渡して件数によらず1文で判定する
  async attach(ids: readonly string[]): Promise<readonly string[]> {
    const unique = uniqueOf(ids);
    if (unique.length === 0) {
      return [];
    }
    const now = this.clock.now();
    const targets = sql`SELECT key, value AS id FROM json_each(${JSON.stringify(unique)})`;
    const column = (name: SQLiteColumn): SQL =>
      sql`file.${sql.identifier(name.name)}`;
    const unattachable = sql`SELECT target.id AS id FROM (${targets}) AS target LEFT JOIN ${mediaFiles} AS file ON ${column(mediaFiles.id)} = target.id WHERE ${column(mediaFiles.id)} IS NULL OR ${column(mediaFiles.deletedAt)} IS NOT NULL OR ${column(mediaFiles.eraseRequestedAt)} IS NOT NULL ORDER BY target.key`;
    const [rejected] = await this.db.batch([
      this.db.all<{ id: string }>(unattachable),
      this.db
        .update(mediaFiles)
        .set({ attachedAt: now, updatedAt: now })
        .where(
          and(
            sql`${mediaFiles.id} IN (SELECT id FROM (${targets}))`,
            isNull(mediaFiles.attachedAt),
            sql`NOT EXISTS (${unattachable})`,
          ),
        ),
    ]);
    return rejected.map((row) => row.id);
  }

  async markDeleted(ids: readonly string[]): Promise<void> {
    await this.stampUnset(ids, mediaFiles.deletedAt, (now) => ({
      deletedAt: now,
    }));
  }

  async markEraseRequested(ids: readonly string[]): Promise<void> {
    await this.stampUnset(ids, mediaFiles.eraseRequestedAt, (now) => ({
      eraseRequestedAt: now,
    }));
  }

  async remove(ids: readonly string[]): Promise<void> {
    await this.runAll(
      chunk(uniqueOf(ids), IDS_PER_STATEMENT).map((page) =>
        this.db.delete(mediaFiles).where(inArray(mediaFiles.id, page)),
      ),
    );
  }

  async recordModeration(
    id: string,
    record: ModerationRecord,
  ): Promise<boolean> {
    const now = this.clock.now();
    const update = this.db
      .update(mediaFiles)
      .set({
        moderationStatus: record.verdict,
        moderationDetail: record.verdict === 'flagged' ? record.findings : null,
        moderatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaFiles.id, id),
          inArray(mediaFiles.moderationStatus, RECORDABLE_STATUSES),
        ),
      )
      .returning({ id: mediaFiles.id });
    if (record.verdict !== 'flagged') {
      return (await update).length > 0;
    }
    // 一括実行の中では前の文の結果を使えないため、この呼び出しの判定日時で更新が効いたことを確かめてから理由を加える
    const nowMs = now.getTime();
    const auto: QuarantineReason = 'auto';
    const flagged: ModerationStatus = 'flagged';
    const [updated] = await this.db.batch([
      update,
      this.db.run(
        sql`INSERT INTO ${reasons} (${REASON_INSERT_COLUMNS}) SELECT ${this.ids.generate()}, ${id}, ${auto}, ${nowMs}, ${nowMs} WHERE EXISTS (SELECT 1 FROM ${mediaFiles} WHERE ${mediaFiles.id} = ${id} AND ${mediaFiles.moderationStatus} = ${flagged} AND ${mediaFiles.moderatedAt} = ${nowMs}) ON CONFLICT DO NOTHING`,
      ),
    ]);
    return updated.length > 0;
  }

  // 呼び出しの間に物理削除された記録へは理由を加えず、外部キーの違反で一括実行の全体を失敗させない
  async addReasons(
    ids: readonly string[],
    reason: QuarantineReason,
  ): Promise<void> {
    const nowMs = this.clock.now().getTime();
    await this.runAll(
      chunk(uniqueOf(ids), REASON_ROWS_PER_STATEMENT).map((page) => {
        const candidates = sql.join(
          page.map((fileId) => sql`(${this.ids.generate()}, ${fileId})`),
          sql`, `,
        );
        return this.db.run(
          sql`INSERT INTO ${reasons} (${REASON_INSERT_COLUMNS}) SELECT candidate.column1, candidate.column2, ${reason}, ${nowMs}, ${nowMs} FROM (VALUES ${candidates}) AS candidate WHERE candidate.column2 IN (SELECT ${mediaFiles.id} FROM ${mediaFiles}) ON CONFLICT DO NOTHING`,
        );
      }),
    );
  }

  async removeReasons(
    ids: readonly string[],
    reason: QuarantineReason,
  ): Promise<void> {
    await this.runAll(
      chunk(uniqueOf(ids), IDS_PER_STATEMENT).map((page) =>
        this.db
          .delete(reasons)
          .where(
            and(eq(reasons.reason, reason), inArray(reasons.fileId, page)),
          ),
      ),
    );
  }

  async updateLocation(
    id: string,
    from: MediaLocation,
    to: MediaLocation,
  ): Promise<boolean> {
    const now = this.clock.now();
    const updated = await this.db
      .update(mediaFiles)
      .set({ location: to, updatedAt: now })
      .where(and(eq(mediaFiles.id, id), eq(mediaFiles.location, from)))
      .returning({ id: mediaFiles.id });
    return updated.length > 0;
  }

  async findIdsOwnedBy(
    owner: OwnerRef,
    limit: number,
  ): Promise<readonly string[]> {
    return this.selectIds(ownedBy(owner), limit);
  }

  // 索引(owner_kind, owner_id)の順に読むため、重複の除去と並べ替えに表全体の走査を要しない
  async findOwnerIds(input: OwnerIdListInput): Promise<readonly string[]> {
    const rows = await this.db
      .selectDistinct({ ownerId: mediaFiles.ownerId })
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.ownerKind, input.kind),
          input.after === undefined
            ? isNotNull(mediaFiles.ownerId)
            : gt(mediaFiles.ownerId, input.after),
        ),
      )
      .orderBy(asc(mediaFiles.ownerId))
      .limit(input.limit);
    return rows.flatMap((row) => (row.ownerId === null ? [] : [row.ownerId]));
  }

  async findOwnedImageIdsByReason(
    input: OwnedImageQuery,
  ): Promise<readonly string[]> {
    return this.selectIds(
      and(
        ownedBy(input.owner),
        eq(mediaFiles.storage, 'images'),
        input.hasReason
          ? reasonExists(input.reason)
          : and(
              not(reasonExists(input.reason)),
              isNull(mediaFiles.eraseRequestedAt),
            ),
      ),
      input.limit,
    );
  }

  async findEraseCandidates(
    input: EraseCandidateQuery,
  ): Promise<readonly string[]> {
    return this.selectIds(
      or(
        isNotNull(mediaFiles.eraseRequestedAt),
        lt(mediaFiles.deletedAt, input.deletedBefore),
        and(
          isNull(mediaFiles.attachedAt),
          lt(mediaFiles.createdAt, input.unattachedCreatedBefore),
        ),
      ),
      input.limit,
    );
  }

  async findModerationRequeueCandidates(
    input: ModerationRequeueQuery,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(
        and(
          isNull(mediaFiles.deletedAt),
          isNull(mediaFiles.eraseRequestedAt),
          or(
            eq(mediaFiles.moderationStatus, 'undetermined'),
            and(
              eq(mediaFiles.moderationStatus, 'pending'),
              lt(mediaFiles.createdAt, input.pendingCreatedBefore),
            ),
          ),
        ),
      )
      .orderBy(asc(mediaFiles.createdAt), asc(mediaFiles.id))
      .limit(input.limit);
    return rows.map((row) => row.id);
  }

  async findLocationMismatches(limit: number): Promise<readonly string[]> {
    return this.selectIds(
      and(
        eq(mediaFiles.storage, 'images'),
        or(
          and(eq(mediaFiles.location, 'images'), reasonExists()),
          and(eq(mediaFiles.location, 'quarantine'), not(reasonExists())),
        ),
      ),
      limit,
    );
  }

  async listQuarantined(
    input: QuarantinedImageListInput,
  ): Promise<QuarantinedImageList> {
    const rows = await this.db
      .select({
        reasonId: reasons.id,
        fileId: reasons.fileId,
        quarantinedAt: reasons.createdAt,
        detail: mediaFiles.moderationDetail,
      })
      .from(reasons)
      .innerJoin(mediaFiles, eq(mediaFiles.id, reasons.fileId))
      .where(
        and(
          eq(reasons.reason, input.reason),
          isNull(mediaFiles.eraseRequestedAt),
          afterCursor(input.cursor),
        ),
      )
      .orderBy(desc(reasons.createdAt), desc(reasons.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const views = await this.findViews(page.map((row) => row.fileId));
    const items = page.flatMap((row): QuarantinedImage[] => {
      const file = views.get(row.fileId);
      return file === undefined
        ? []
        : [
            {
              file,
              quarantinedAt: row.quarantinedAt,
              findings: toModerationFindings(row.detail),
            },
          ];
    });
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? encodeCursor({
              quarantinedAt: last.quarantinedAt.getTime(),
              reasonId: last.reasonId,
            })
          : undefined,
    };
  }

  private async selectIds(
    condition: SQL | undefined,
    limit: number,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(condition)
      .orderBy(asc(mediaFiles.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  private async stampUnset(
    ids: readonly string[],
    column: SQLiteColumn,
    stamp: (now: Date) => Partial<typeof mediaFiles.$inferInsert>,
  ): Promise<void> {
    const now = this.clock.now();
    await this.runAll(
      chunk(uniqueOf(ids), IDS_PER_STATEMENT).map((page) =>
        this.db
          .update(mediaFiles)
          .set({ ...stamp(now), updatedAt: now })
          .where(and(inArray(mediaFiles.id, page), isNull(column))),
      ),
    );
  }

  // 分割した文を1つの一括実行にまとめ、途中で失敗した場合に一部の記録だけが変わった状態を残さない
  private async runAll(
    statements: readonly BatchItem<'sqlite'>[],
  ): Promise<void> {
    const [first, ...rest] = statements;
    if (first === undefined) {
      return;
    }
    await this.db.batch([first, ...rest]);
  }
}
