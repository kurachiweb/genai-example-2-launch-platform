import { inject, injectable } from 'inversify';

import {
  HELP_ARTICLE_CREATE_ACTION,
  HELP_ARTICLE_DELETE_ACTION,
  HELP_ARTICLE_REORDER_ACTION,
  HELP_ARTICLE_UPDATE_ACTION,
} from '../../../common-lib/admin/audit-actions/help-center.ts';
import { isSameHandle } from '../../../common-lib/handles/handle-rules.ts';
import { sortHelpArticles } from '../../../common-lib/help/help-ordering.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  type HelpHandleChange,
  planHelpHandleChange,
} from '../../domain/help/help-handle-change.ts';
import { helpCategoryMissingError, helpError } from './help-errors.ts';
import { HELP_TYPES } from './help-types.ts';
import {
  HELP_ARTICLE_SEARCH_TARGET_NAME,
  type HelpArticleListRecord,
  type HelpArticleRecord,
  type HelpArticleSaveResult,
  type HelpArticleStore,
  type HelpArticleWrite,
} from './ports.ts';

export type HelpArticleUpdate = HelpArticleWrite & {
  readonly id: string;
  readonly expectedRevision: number;
};

// 入力の形式・文字数はリゾルバが検証し、タイトル・サブタイトルは前後の空白を除いた値で受け取る。どの操作もモデレーター以上の認可を通したリゾルバから呼ぶ
export interface HelpArticleEditor {
  create(
    admin: CurrentAdmin,
    input: HelpArticleWrite,
    reason: string | undefined,
  ): Promise<HelpArticleRecord>;
  update(
    admin: CurrentAdmin,
    input: HelpArticleUpdate,
    reason: string | undefined,
  ): Promise<HelpArticleRecord>;
  delete(
    admin: CurrentAdmin,
    input: { readonly id: string; readonly reason: string | undefined },
  ): Promise<void>;
  // ピン留めの群に続けてそれ以外の群の順でIDを渡し、並べ替えた後のそのカテゴリの記事を返す
  reorder(
    admin: CurrentAdmin,
    input: {
      readonly categoryId: string;
      readonly orderedIds: readonly string[];
    },
  ): Promise<readonly HelpArticleListRecord[]>;
}

const SAVE_FAILURES: Readonly<
  Record<Exclude<HelpArticleSaveResult['kind'], 'saved'>, () => AppError>
> = Object.freeze({
  // 選択肢を表示した後に削除されたカテゴリへの保存は、選び直しを促す
  'category-missing': helpCategoryMissingError,
  // 使用中の判定の後に同じハンドルを確定させた保存がある
  'handle-unavailable': () => helpError('help_article_handle_unavailable'),
  conflict: () => helpError('help_article_conflict'),
  // 確定の直後に削除された場合も、削除された記事として扱う
  'not-found': () => helpError('help_article_not_found'),
});

const savedRecordOf = (result: HelpArticleSaveResult): HelpArticleRecord => {
  if (result.kind !== 'saved') {
    throw SAVE_FAILURES[result.kind]();
  }
  return result.record;
};

const writeOf = (input: HelpArticleWrite): HelpArticleWrite => ({
  handle: input.handle,
  title: input.title,
  subtitle: input.subtitle,
  bodyMarkdown: input.bodyMarkdown,
  categoryId: input.categoryId,
  pinned: input.pinned,
  status: input.status,
});

const reasonOf = (
  reason: string | undefined,
): Pick<AuditEntryInput, 'reason'> => (reason === undefined ? {} : { reason });

@injectable()
export class StoreHelpArticleEditor implements HelpArticleEditor {
  constructor(
    @inject(HELP_TYPES.HelpArticleStore)
    private readonly store: HelpArticleStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(SEARCH_TYPES.RefreshRequester)
    private readonly refreshRequester: SearchIndexRefreshRequester,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async create(
    admin: CurrentAdmin,
    input: HelpArticleWrite,
    reason: string | undefined,
  ): Promise<HelpArticleRecord> {
    // ヘルプ記事のハンドルは予約語を持たないため、他の記事の現在のハンドルとの重複だけを確かめる
    if (await this.store.isHandleOccupied(input.handle)) {
      throw helpError('help_article_handle_unavailable');
    }
    const id = this.ids.generate();
    const now = this.clock.now();
    const audit = this.#prepare(admin, {
      action: HELP_ARTICLE_CREATE_ACTION.name,
      targetIds: [id],
      ...reasonOf(reason),
      detail: { status: input.status },
      occurredAt: now,
    });
    const write = writeOf(input);
    const record = savedRecordOf(
      await this.store.create({
        id,
        write,
        createdByAdminId: admin.id,
        now,
        audit,
      }),
    );
    await this.#requestRefreshIfPublished(write, id);
    return record;
  }

  async update(
    admin: CurrentAdmin,
    input: HelpArticleUpdate,
    reason: string | undefined,
  ): Promise<HelpArticleRecord> {
    const current = await this.store.findById(input.id);
    if (current === undefined) {
      throw helpError('help_article_not_found');
    }
    if (current.revision !== input.expectedRevision) {
      throw helpError('help_article_conflict');
    }
    const handleChange = planHelpHandleChange(current.handle, input.handle);
    await this.#assertHandleAvailable(current, handleChange);
    const now = this.clock.now();
    const audit = this.#prepare(admin, {
      action: HELP_ARTICLE_UPDATE_ACTION.name,
      targetIds: [current.id],
      ...reasonOf(reason),
      ...(current.status === input.status
        ? {}
        : { detail: { fromStatus: current.status, toStatus: input.status } }),
      occurredAt: now,
    });
    const write = writeOf(input);
    const record = savedRecordOf(
      await this.store.update({
        id: current.id,
        expectedRevision: input.expectedRevision,
        write,
        handleChange,
        categoryChanged: current.categoryId !== input.categoryId,
        now,
        audit,
      }),
    );
    await this.#requestRefreshIfPublished(write, current.id);
    return record;
  }

  async delete(
    admin: CurrentAdmin,
    input: { readonly id: string; readonly reason: string | undefined },
  ): Promise<void> {
    const current = await this.store.findById(input.id);
    if (current === undefined) {
      throw helpError('help_article_not_found');
    }
    const audit = this.#prepare(admin, {
      action: HELP_ARTICLE_DELETE_ACTION.name,
      targetIds: [current.id],
      ...reasonOf(input.reason),
      occurredAt: this.clock.now(),
    });
    const result = await this.store.delete({ id: current.id, audit });
    if (result === 'not-found') {
      throw helpError('help_article_not_found');
    }
  }

  async reorder(
    admin: CurrentAdmin,
    input: {
      readonly categoryId: string;
      readonly orderedIds: readonly string[];
    },
  ): Promise<readonly HelpArticleListRecord[]> {
    const audit = this.#prepare(admin, {
      action: HELP_ARTICLE_REORDER_ACTION.name,
      targetIds: [input.categoryId],
      detail: { count: String(input.orderedIds.length) },
      occurredAt: this.clock.now(),
    });
    const result = await this.store.reorder({
      categoryId: input.categoryId,
      orderedIds: input.orderedIds,
      audit,
    });
    if (result === 'outdated') {
      throw helpError('help_order_outdated');
    }
    const articles = await this.store.listAll();
    return sortHelpArticles(
      articles.filter((article) => article.categoryId === input.categoryId),
    );
  }

  // 大文字小文字だけの変更と現在の値の維持は記事自身のハンドルのままのため判定しない
  async #assertHandleAvailable(
    current: HelpArticleRecord,
    handleChange: HelpHandleChange,
  ): Promise<void> {
    if (handleChange.kind !== 'changed') {
      return;
    }
    // 記事自身が保持する旧ハンドルは、他の記事が現在のハンドルにすると保持から外れるため、保持していれば使える
    if (
      current.previousHandle !== null &&
      isSameHandle(current.previousHandle, handleChange.next)
    ) {
      return;
    }
    if (await this.store.isHandleOccupied(handleChange.next, current.id)) {
      throw helpError('help_article_handle_unavailable');
    }
  }

  // 送信の失敗は要求の部品が記録して例外にせず、保存と同じ一括の書き込みで更新待ちにした索引文書を後の再処理が完了させる。
  // 例外は未登録の検索対象など呼び出し側の誤りだけのため、確定の後でも想定外の例外として伝えてエラートラッキングへ届ける
  async #requestRefreshIfPublished(
    write: HelpArticleWrite,
    articleId: string,
  ): Promise<void> {
    if (write.status !== 'published') {
      return;
    }
    await this.refreshRequester.requestRefresh(
      HELP_ARTICLE_SEARCH_TARGET_NAME,
      articleId,
    );
  }

  #prepare(
    admin: CurrentAdmin,
    entry: Omit<AuditEntryInput, 'operatorAdminId'>,
  ): PreparedAuditEntry {
    return this.auditLog.prepare({ operatorAdminId: admin.id, ...entry });
  }
}
