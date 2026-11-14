import type { DisposableEmailStatus } from '../../../lib/core/identity/disposable-email.ts';
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

export interface UserEmailLookup {
  // 退会済みの利用者のメールアドレスも返す。行が無ければundefined
  findEmail(userId: string): Promise<string | undefined>;
}

export interface DisposableRecheckSubject {
  readonly email: string;
  readonly withdrawn: boolean;
  readonly emailVerified: boolean;
  // 確認前やメールアドレスの変更の直後はnull
  readonly status: DisposableEmailStatus | null;
}

export interface DisposableStatusStore {
  // 退会済みの利用者も返す。行が無ければundefined
  findSubject(userId: string): Promise<DisposableRecheckSubject | undefined>;
  // 判定したメールアドレスのままで、退会しておらず確認済みで、判定が確定していない場合だけ保存する
  saveRecheckResult(
    userId: string,
    email: string,
    status: DisposableEmailStatus,
    at: Date,
  ): Promise<void>;
}
