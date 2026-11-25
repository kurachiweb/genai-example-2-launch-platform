import type { Logger } from '@logtape/logtape';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import type { Database } from '../../../db/client.ts';
import { mediaFileQuarantineReasons } from '../../../db/schema/media/media-file-quarantine-reasons.ts';
import { mediaFiles } from '../../../db/schema/media/media-files.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  MediaFileView,
  QuarantineReason,
} from '../../core/media/media-file.ts';
import { RELOCATE_FILES_MESSAGE } from '../../core/media/media-messages.ts';
import type { MediaEraser, MediaFileStore } from '../../core/media/ports.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  type MessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import {
  quarantineNotApplicable,
  storageUnavailable,
} from './media-operation-errors.ts';
import { needsRelocation, type ReasonChange } from './quarantine-relocation.ts';

export type MediaModerationResult = 'changed' | 'unchanged' | 'not-found';

export interface MediaModerationInput {
  readonly fileId: string;
  // 状態を変えるときだけ、状態の変更の後に同じ一括の書き込みへ並べる
  readonly statements: readonly BatchItem<'sqlite'>[];
}

export interface MediaReasonModerationInput extends MediaModerationInput {
  readonly reason: QuarantineReason;
}

// 呼び出し側の文を受け取るため、文を扱うinfrastructure層だけが使う。画像用でない用途のファイルはAppError(bad_request, quarantine_not_applicable)、確定の後の移動の依頼・即時の削除の失敗はAppError(unavailable, storage_unavailable)で、状態と呼び出し側の文は確定したまま残る
export interface MediaModerationControl {
  // 対象が無い・削除待ちならnot-found
  addReason(input: MediaReasonModerationInput): Promise<MediaModerationResult>;
  // 対象が無い・削除待ちならnot-found
  removeReason(
    input: MediaReasonModerationInput,
  ): Promise<MediaModerationResult>;
  // 対象が無ければnot-found、既に削除待ちならunchanged
  requestErase(input: MediaModerationInput): Promise<MediaModerationResult>;
}

export interface D1MediaModerationControlDependencies {
  readonly db: Database;
  readonly files: MediaFileStore;
  readonly publisher: MessagePublisher;
  readonly eraser: MediaEraser;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly appName: LoggingOptions['appName'];
}

type ProgressOf = (
  file: MediaFileView | undefined,
) => MediaModerationResult | 'pending';

const reasons = mediaFileQuarantineReasons;

// 検査の行は条件が成り立てば1行も挿入しないため、理由の種類は制約を満たす値であれば何でもよい
const GUARD_REASON: QuarantineReason = 'auto';

// D1は`D1_ERROR: NOT NULL constraint failed: media_file_quarantine_reasons.file_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const GUARD_VIOLATION_PATTERN =
  /NOT NULL constraint failed: media_file_quarantine_reasons\.file_id(?::|$)/u;

function isGuardViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (GUARD_VIOLATION_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

function reasonProgress(
  reason: QuarantineReason,
  change: ReasonChange,
): ProgressOf {
  return (file) => {
    if (file === undefined || file.eraseRequested) {
      return 'not-found';
    }
    const hasReason = file.quarantineReasons.includes(reason);
    return hasReason === (change === 'add') ? 'unchanged' : 'pending';
  };
}

const eraseProgress: ProgressOf = (file) => {
  if (file === undefined) {
    return 'not-found';
  }
  return file.eraseRequested ? 'unchanged' : 'pending';
};

function fileActive(fileId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${mediaFiles} WHERE ${and(
    eq(mediaFiles.id, fileId),
    isNull(mediaFiles.eraseRequestedAt),
  )})`;
}

function reasonExists(fileId: string, reason: QuarantineReason): SQL {
  return sql`EXISTS (SELECT 1 FROM ${reasons} WHERE ${and(
    eq(reasons.fileId, fileId),
    eq(reasons.reason, reason),
  )})`;
}

export class D1MediaModerationControl implements MediaModerationControl {
  readonly #db: Database;
  readonly #files: MediaFileStore;
  readonly #publisher: MessagePublisher;
  readonly #eraser: MediaEraser;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #logger: Logger;

  constructor(dependencies: D1MediaModerationControlDependencies) {
    this.#db = dependencies.db;
    this.#files = dependencies.files;
    this.#publisher = dependencies.publisher;
    this.#eraser = dependencies.eraser;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#logger = getAppLogger([
      dependencies.appName,
      'media',
      'moderation-control',
    ]);
  }

  async addReason(
    input: MediaReasonModerationInput,
  ): Promise<MediaModerationResult> {
    const { fileId, reason } = input;
    const now = this.#clock.now();
    return this.#changeReason(input, 'add', [
      this.#guard(
        sql`${fileActive(fileId)} AND NOT ${reasonExists(fileId, reason)}`,
      ),
      this.#db.insert(reasons).values({
        id: this.#ids.generate(),
        fileId,
        reason,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  }

  async removeReason(
    input: MediaReasonModerationInput,
  ): Promise<MediaModerationResult> {
    const { fileId, reason } = input;
    return this.#changeReason(input, 'remove', [
      this.#guard(
        sql`${fileActive(fileId)} AND ${reasonExists(fileId, reason)}`,
      ),
      this.#db
        .delete(reasons)
        .where(and(eq(reasons.fileId, fileId), eq(reasons.reason, reason))),
    ]);
  }

  async requestErase(
    input: MediaModerationInput,
  ): Promise<MediaModerationResult> {
    const { fileId } = input;
    const now = this.#clock.now();
    const { result } = await this.#commit(input, eraseProgress, [
      this.#guard(fileActive(fileId)),
      this.#db
        .update(mediaFiles)
        .set({ eraseRequestedAt: now, updatedAt: now })
        .where(eq(mediaFiles.id, fileId)),
    ]);
    if (result === 'changed') {
      await this.#eraseNow(fileId);
    }
    return result;
  }

  async #changeReason(
    input: MediaReasonModerationInput,
    change: ReasonChange,
    changeStatements: readonly BatchItem<'sqlite'>[],
  ): Promise<MediaModerationResult> {
    const { result, file } = await this.#commit(
      input,
      reasonProgress(input.reason, change),
      changeStatements,
    );
    if (
      file !== undefined &&
      result !== 'not-found' &&
      needsRelocation(file, input.reason, change)
    ) {
      await this.#requestRelocation(file.id, input.reason);
    }
    return result;
  }

  // 返すファイルは結果を決めた時点の記録で、変更したときは変更の前の記録である
  async #commit(
    input: MediaModerationInput,
    progressOf: ProgressOf,
    changeStatements: readonly BatchItem<'sqlite'>[],
  ): Promise<{
    readonly result: MediaModerationResult;
    readonly file: MediaFileView | undefined;
  }> {
    const file = await this.#viewOf(input.fileId);
    if (file !== undefined && file.storage !== 'images') {
      throw quarantineNotApplicable();
    }
    const progress = progressOf(file);
    if (progress !== 'pending') {
      return { result: progress, file };
    }
    const [first, ...rest] = [...changeStatements, ...input.statements];
    if (first === undefined) {
      throw new Error('状態の変更の文がありません。');
    }
    try {
      await this.#db.batch([first, ...rest]);
      return { result: 'changed', file };
    } catch (error) {
      if (!isGuardViolation(error)) {
        throw error;
      }
      const latest = await this.#viewOf(input.fileId);
      const reread = progressOf(latest);
      if (reread === 'pending') {
        throw error;
      }
      return { result: reread, file: latest };
    }
  }

  async #viewOf(fileId: string): Promise<MediaFileView | undefined> {
    return (await this.#files.findViews([fileId])).get(fileId);
  }

  // 状態を読んだ後に別の操作が対象を変えていれば、file_idのNOT NULLの違反で呼び出し側の文ごと一括の書き込みを取り消す。記録が物理削除された場合も取り消すため、更新の件数に頼らず対象の行の有無によらない挿入で判定する
  #guard(condition: SQL): BatchItem<'sqlite'> {
    const nowMs = this.#clock.now().getTime();
    const columns = sql.join(
      [
        reasons.id,
        reasons.fileId,
        reasons.reason,
        reasons.createdAt,
        reasons.updatedAt,
      ].map((column) => sql.identifier(column.name)),
      sql`, `,
    );
    return this.#db.run(
      sql`INSERT INTO ${reasons} (${columns}) SELECT ${this.#ids.generate()}, NULL, ${GUARD_REASON}, ${nowMs}, ${nowMs} WHERE NOT (${condition})`,
    );
  }

  // 移動は受信側が記録を読み直して目的の保存先へそろえるため、理由を確定させた後に送る。送れなければ日次の保存先の照合がそろえる
  async #requestRelocation(
    fileId: string,
    reason: QuarantineReason,
  ): Promise<void> {
    try {
      await this.#publisher.publish(RELOCATE_FILES_MESSAGE, {
        fileIds: [fileId],
      });
    } catch (error) {
      if (error instanceof MessagePublishError) {
        throw error;
      }
      this.#logger.warn('隔離理由の変更に伴う移動の依頼を送れませんでした', {
        fileCount: 1,
        reason,
        error,
      });
      throw storageUnavailable();
    }
  }

  // 削除待ちの印は確定済みのため、即時の削除に失敗しても日次の削除が完了させる
  async #eraseNow(fileId: string): Promise<void> {
    try {
      await this.#eraser.erase([fileId]);
    } catch (error) {
      this.#logger.warn('ファイルの即時の物理削除を完了できませんでした', {
        fileCount: 1,
        error,
      });
      throw storageUnavailable();
    }
  }
}
