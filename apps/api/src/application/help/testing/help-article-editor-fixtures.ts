import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../../lib/core/admin/current-admin.ts';
import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../../lib/core/ids/id-generator.ts';
import type { SearchIndexRefreshRequester } from '../../../../lib/core/search/ports.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import { StoreHelpArticleEditor } from '../help-article-editor.ts';
import type {
  HelpArticleCreateInput,
  HelpArticleListRecord,
  HelpArticleRecord,
  HelpArticleSaveResult,
  HelpArticleStore,
  HelpArticleUpdateInput,
  HelpArticleWrite,
  HelpReorderResult,
} from '../ports.ts';

export const NOW = new Date('2026-11-11T09:00:00.000Z');
const CREATED_AT = new Date('2026-11-01T00:00:00.000Z');
export const ARTICLE_ID = '01JD0HART00000000000000001';
export const NEW_ARTICLE_ID = '01JD0HART0000000000000NEW1';
export const AUTHOR_ADMIN_ID = '01JBX8Y4Z5AUTHOR000000000A';
export const USAGE_ID = '01JD0HCAT00000000000000001';
export const BILLING_ID = '01JD0HCAT00000000000000002';
export const TITLE = 'パスワードを再設定する';
export const SUBTITLE = 'ログインできないときの手順';
export const BODY_PHRASE = '設定画面から再設定のメールを送ります。';
export const REASON = '手順の誤りを直すため';

export const CURRENT: CurrentAdmin = Object.freeze({
  id: '01JBX8Y4Z5ABCDEFGHJKMNPQRS',
  role: 'moderator',
  nickname: '運営の管理者',
  sessionId: 'session-1',
});

export const writeOf = (
  overrides: Partial<HelpArticleWrite> = {},
): HelpArticleWrite =>
  Object.freeze({
    handle: 'reset-password',
    title: TITLE,
    subtitle: SUBTITLE,
    bodyMarkdown: `## 手順\n\n${BODY_PHRASE}`,
    categoryId: USAGE_ID,
    pinned: false,
    status: 'published',
    ...overrides,
  });

// 下書きで、旧ハンドルを持たない既存の記事
export const ARTICLE: HelpArticleRecord = Object.freeze({
  ...writeOf({ handle: 'guide', status: 'draft' }),
  id: ARTICLE_ID,
  previousHandle: null,
  categoryName: '使い方',
  createdByAdminId: AUTHOR_ADMIN_ID,
  sortOrder: 2,
  revision: 3,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

export const updateInputOf = (
  overrides: Partial<HelpArticleWrite> = {},
  expectedRevision = ARTICLE.revision,
) => ({
  ...writeOf({ handle: ARTICLE.handle, status: ARTICLE.status, ...overrides }),
  id: ARTICLE_ID,
  expectedRevision,
});

export const listRecordOf = (
  id: string,
  overrides: Partial<HelpArticleListRecord> = {},
): HelpArticleListRecord =>
  Object.freeze({
    id,
    handle: `article-${id.slice(-1)}`,
    title: `記事${id.slice(-1)}`,
    categoryId: USAGE_ID,
    categoryName: '使い方',
    pinned: false,
    status: 'published',
    createdByAdminId: AUTHOR_ADMIN_ID,
    sortOrder: 1,
    revision: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  });

export type FailedSaveKind = Exclude<HelpArticleSaveResult['kind'], 'saved'>;

export interface EditorFakeOptions {
  readonly articles?: readonly HelpArticleRecord[];
  readonly listed?: readonly HelpArticleListRecord[];
  // 他の記事の現在のハンドル(大文字小文字を区別しない)
  readonly occupiedHandles?: readonly string[];
  readonly createResult?: FailedSaveKind;
  readonly updateResult?: FailedSaveKind;
  readonly deleteResult?: 'deleted' | 'not-found';
  readonly reorderResult?: HelpReorderResult;
  readonly prepareError?: AppError;
  readonly refreshError?: Error;
}

const savedCreateOf = (input: HelpArticleCreateInput): HelpArticleRecord => ({
  ...input.write,
  id: input.id,
  previousHandle: null,
  categoryName: '使い方',
  createdByAdminId: input.createdByAdminId,
  sortOrder: 5,
  revision: 1,
  createdAt: input.now,
  updatedAt: input.now,
});

const savedUpdateOf = (
  current: HelpArticleRecord,
  input: HelpArticleUpdateInput,
): HelpArticleRecord => ({
  ...current,
  ...input.write,
  previousHandle:
    input.handleChange.kind === 'changed'
      ? input.handleChange.previous
      : current.previousHandle,
  revision: current.revision + 1,
  updatedAt: input.now,
});

interface FakeRecorder {
  readonly calls: string[];
  readonly prepared: AuditEntryInput[];
  readonly preparedEntries: PreparedAuditEntry[];
  readonly writes: { readonly method: string; readonly input: unknown }[];
  readonly occupancyChecks: (readonly [string, string | undefined])[];
  readonly refreshes: (readonly [string, string])[];
}

const createFakeStore = (
  options: EditorFakeOptions,
  recorder: FakeRecorder,
): HelpArticleStore => {
  const { calls, writes, occupancyChecks } = recorder;
  const articles = options.articles ?? [ARTICLE];
  const occupied = (options.occupiedHandles ?? []).map((handle) =>
    handle.toLowerCase(),
  );
  return {
    findById: (id) => {
      calls.push('findById');
      return Promise.resolve(articles.find((article) => article.id === id));
    },
    listAll: () => {
      calls.push('listAll');
      return Promise.resolve(options.listed ?? []);
    },
    isHandleOccupied: (handle, exceptArticleId) => {
      calls.push('isHandleOccupied');
      occupancyChecks.push([handle, exceptArticleId]);
      return Promise.resolve(occupied.includes(handle.toLowerCase()));
    },
    findPreviousHandleHolder: () =>
      Promise.reject(new Error('旧ハンドルの保持者の照会は呼ばれない想定です')),
    create: (input) => {
      calls.push('create');
      writes.push({ method: 'create', input });
      return Promise.resolve(
        options.createResult === undefined
          ? { kind: 'saved', record: savedCreateOf(input) }
          : { kind: options.createResult },
      );
    },
    update: (input) => {
      calls.push('update');
      writes.push({ method: 'update', input });
      const current = articles.find((article) => article.id === input.id);
      if (current === undefined) {
        return Promise.resolve({ kind: 'not-found' });
      }
      return Promise.resolve(
        options.updateResult === undefined
          ? { kind: 'saved', record: savedUpdateOf(current, input) }
          : { kind: options.updateResult },
      );
    },
    delete: (input) => {
      calls.push('delete');
      writes.push({ method: 'delete', input });
      return Promise.resolve(options.deleteResult ?? 'deleted');
    },
    reorder: (input) => {
      calls.push('reorder');
      writes.push({ method: 'reorder', input });
      return Promise.resolve(options.reorderResult ?? 'reordered');
    },
  };
};

// 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る。記録の検証そのものは監査ログのテストが確かめる
const createFakeAuditLog = (
  options: EditorFakeOptions,
  { calls, prepared, preparedEntries }: FakeRecorder,
): AuditLogRecorder => ({
  prepare: (entry) => {
    calls.push('prepare');
    prepared.push(entry);
    if (options.prepareError !== undefined) {
      throw options.prepareError;
    }
    const entryOf = Object.freeze({
      id: `audit-${String(prepared.length)}`,
      operatorAdminId: entry.operatorAdminId,
      action: entry.action,
      targetKind: 'help-article',
      targetIds: entry.targetIds,
      reason: entry.reason ?? null,
      detail: entry.detail ?? {},
      occurredAt: entry.occurredAt,
    }) as PreparedAuditEntry;
    preparedEntries.push(entryOf);
    return entryOf;
  },
  record: () => Promise.reject(new Error('単独の記録は呼ばれない想定です')),
});

export function setupEditor(options: EditorFakeOptions = {}) {
  const recorder: FakeRecorder = {
    calls: [],
    prepared: [],
    preparedEntries: [],
    writes: [],
    occupancyChecks: [],
    refreshes: [],
  };
  const refreshRequester: SearchIndexRefreshRequester = {
    requestRefresh: (target, sourceId) => {
      recorder.calls.push('requestRefresh');
      recorder.refreshes.push([target, sourceId]);
      return options.refreshError === undefined
        ? Promise.resolve()
        : Promise.reject(options.refreshError);
    },
  };
  const ids: IdGenerator = { generate: () => NEW_ARTICLE_ID };
  const clock: Clock = { now: () => new Date(NOW) };
  const editor = new StoreHelpArticleEditor(
    createFakeStore(options, recorder),
    createFakeAuditLog(options, recorder),
    refreshRequester,
    ids,
    clock,
  );
  return { editor, ...recorder };
}

export async function rejectionOf(
  promise: Promise<unknown>,
): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) {
    throw new Error('AppErrorで拒否される想定です', { cause: error });
  }
  return error;
}

export const summaryOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  details: error.details,
});

export const HANDLE_UNAVAILABLE = {
  kind: 'conflict',
  code: 'help_article_handle_unavailable',
  details: [
    {
      field: 'handle',
      code: 'unavailable',
      message:
        'このハンドルは既に使われています。別の文字列を入力してください。',
    },
  ],
} as const;

export const ARTICLE_NOT_FOUND = {
  kind: 'not_found',
  code: 'help_article_not_found',
  details: undefined,
} as const;

export const ARTICLE_CONFLICT = {
  kind: 'conflict',
  code: 'help_article_conflict',
  details: undefined,
} as const;

const CATEGORY_MISSING = {
  kind: 'bad_request',
  code: 'validation_error',
  details: [
    {
      field: 'categoryId',
      code: 'not-found',
      message: 'カテゴリを選択してください。',
    },
  ],
} as const;

export const SAVE_FAILURES = [
  ['category-missing', CATEGORY_MISSING],
  ['handle-unavailable', HANDLE_UNAVAILABLE],
  ['conflict', ARTICLE_CONFLICT],
  ['not-found', ARTICLE_NOT_FOUND],
] as const;

export const PREPARE_REJECTION = new AppError({
  kind: 'bad_request',
  code: 'validation_error',
  message: '入力内容を確認してください。',
});
