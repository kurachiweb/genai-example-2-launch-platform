import { inject, injectable } from 'inversify';

import {
  checkHandleFormat,
  isSameHandle,
} from '../../../common-lib/handles/handle-rules.ts';
import { HELP_ARTICLE_HANDLE_RULE } from '../../../common-lib/help/help-input-rules.ts';
import type { HelpAuthorLookup, HelpAuthorView } from './help-authors.ts';
import { HELP_TYPES } from './help-types.ts';
import type {
  HelpArticleListRecord,
  HelpArticleRecord,
  HelpArticleStore,
} from './ports.ts';

export type HelpHandleAvailabilityResult =
  | 'available'
  // 他の記事の旧ハンドルと一致し、保存するとその記事の旧URLの転送が無くなる
  | 'available-releases-previous'
  | 'unavailable'
  | 'invalid';

export interface AdminHelpArticleView extends HelpArticleRecord {
  // nullは削除済みの管理者
  readonly creator: HelpAuthorView | null;
}

export interface AdminHelpArticleRowView extends HelpArticleListRecord {
  readonly creator: HelpAuthorView | null;
}

// どの照会も全ロールの管理者の認可を通したリゾルバから呼ぶ
export interface HelpArticleAdminReader {
  // 下書きを含む全件を更新日時の新しい順に返す
  listAll(): Promise<readonly AdminHelpArticleRowView[]>;
  find(id: string): Promise<AdminHelpArticleView | undefined>;
  // articleIdは編集中の記事のIDで、作成ではundefined
  checkHandle(
    handle: string,
    articleId: string | undefined,
  ): Promise<HelpHandleAvailabilityResult>;
}

const byNewestUpdate = (
  a: HelpArticleListRecord,
  b: HelpArticleListRecord,
): number =>
  b.updatedAt.getTime() - a.updatedAt.getTime() ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const creatorOf = (
  adminId: string,
  authors: ReadonlyMap<string, HelpAuthorView>,
): HelpAuthorView | null => authors.get(adminId) ?? null;

@injectable()
export class StoreHelpArticleAdminReader implements HelpArticleAdminReader {
  constructor(
    @inject(HELP_TYPES.HelpArticleStore)
    private readonly store: HelpArticleStore,
    @inject(HELP_TYPES.HelpAuthorLookup)
    private readonly authors: HelpAuthorLookup,
  ) {}

  async listAll(): Promise<readonly AdminHelpArticleRowView[]> {
    const articles = await this.store.listAll();
    if (articles.length === 0) {
      return [];
    }
    const authors = await this.authors.find([
      ...new Set(articles.map((article) => article.createdByAdminId)),
    ]);
    return articles.toSorted(byNewestUpdate).map((article) => ({
      ...article,
      creator: creatorOf(article.createdByAdminId, authors),
    }));
  }

  async find(id: string): Promise<AdminHelpArticleView | undefined> {
    const article = await this.store.findById(id);
    if (article === undefined) {
      return undefined;
    }
    const authors = await this.authors.find([article.createdByAdminId]);
    return {
      ...article,
      creator: creatorOf(article.createdByAdminId, authors),
    };
  }

  // ヘルプ記事のハンドルは予約語を持たないため、形式と他の記事のハンドルだけを判定する
  async checkHandle(
    handle: string,
    articleId: string | undefined,
  ): Promise<HelpHandleAvailabilityResult> {
    if (checkHandleFormat(handle, HELP_ARTICLE_HANDLE_RULE) !== 'ok') {
      return 'invalid';
    }
    const editing =
      articleId === undefined
        ? undefined
        : await this.store.findById(articleId);
    if (
      editing !== undefined &&
      [editing.handle, editing.previousHandle].some(
        (own) => own !== null && isSameHandle(own, handle),
      )
    ) {
      return 'available';
    }
    if (await this.store.isHandleOccupied(handle, editing?.id)) {
      return 'unavailable';
    }
    // 他の記事の旧ハンドルは、保存の一括の書き込みで元の保持者から解放するため使える
    const holder = await this.store.findPreviousHandleHolder(
      handle,
      editing?.id,
    );
    return holder === undefined ? 'available' : 'available-releases-previous';
  }
}
