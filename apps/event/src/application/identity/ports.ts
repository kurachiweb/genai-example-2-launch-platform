import type {
  UserLifecycleAsyncHandler,
  UserLifecycleAsyncRegistration,
} from '../../../lib/core/identity/user-lifecycle.ts';

export interface LifecycleHandlerResolver {
  resolve(
    registration: UserLifecycleAsyncRegistration,
  ): UserLifecycleAsyncHandler;
}

export interface IdentityPurgeStore {
  // 利用者自身の認証情報・イベントの記録と利用者の行を1つの一括の書き込みで物理削除する。他のテーブルの行が外部キーで残っていれば失敗する
  purge(userId: string): Promise<void>;
}
