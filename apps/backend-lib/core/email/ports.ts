import type { ExtraHeaders } from './email-headers.ts';
import type { EmailKind } from './email-kind.ts';
import type { SuppressionState } from './suppression-policy.ts';

export interface EmailSendRequest<TInput> {
  readonly kind: EmailKind<string, TInput>;
  readonly to: string;
  readonly input: TInput;
  readonly deadline?: Date;
  readonly headers?: ExtraHeaders;
}

export interface EmailSender {
  // 戻り値は送信要求の識別子で、重複配信の判定と送信済みの記録に使われる
  send<TInput>(request: EmailSendRequest<TInput>): Promise<string>;
}

export type EmailSendErrorReason =
  | 'unknown-kind'
  | 'invalid-input'
  | 'invalid-address'
  | 'invalid-headers'
  | 'invalid-deadline'
  | 'too-large';

const EMAIL_SEND_ERROR_MESSAGES: Readonly<
  Record<EmailSendErrorReason, string>
> = {
  'unknown-kind': '登録されていないメール種別です',
  'invalid-input': 'テンプレート入力がメール種別の検証規則に合いません',
  'invalid-address': '宛先のメールアドレスの形式が不正です',
  'invalid-headers': '追加ヘッダーが許可されていないか、値が不正です',
  'invalid-deadline': '送信期限が有効な日時ではありません',
  'too-large': '送信要求の本文が大きさの上限を超えています',
};

// 呼び出し側のログやエラートラッキングへ宛先・入力の値が漏れないよう、メッセージは理由だけから決める
export class EmailSendError extends Error {
  override readonly name = 'EmailSendError';
  readonly reason: EmailSendErrorReason;

  constructor(reason: EmailSendErrorReason) {
    super(EMAIL_SEND_ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

export type SuppressionStatus =
  | { readonly suppressed: false }
  | ({ readonly suppressed: true } & SuppressionState);

export interface SuppressionList {
  getStatus(address: string): Promise<SuppressionStatus>;
  // 渡したアドレスのうち抑止中のものを照合キーの集合で返す
  findSuppressed(addresses: readonly string[]): Promise<ReadonlySet<string>>;
}

export interface SuppressionRecorder {
  record(address: string, state: SuppressionState): Promise<void>;
}

export interface EmailCleanupSummary {
  readonly expiredSuppressionsDeleted: number;
  readonly unlinkedSuppressionsDeleted: number;
  readonly sendRecordsDeleted: number;
  readonly unlinkedCheck: 'done' | 'skipped-directory-unavailable';
}

export interface SuppressionMaintenance {
  // 同じ求めを繰り返しても結果を変えないため、対象が無くても成功する
  deleteByAddress(address: string): Promise<void>;
  runDailyCleanup(now: Date): Promise<EmailCleanupSummary>;
}

export type UserAddressLookup =
  | { readonly kind: 'available'; readonly registered: ReadonlySet<string> }
  | { readonly kind: 'unavailable' };

export interface UserAddressDirectory {
  // registeredは照合キーの集合。D1のバインド変数の上限に収めるため、1回の呼び出しは最大90件とする
  findRegistered(addresses: readonly string[]): Promise<UserAddressLookup>;
}

export interface SenderInfo {
  readonly businessName: string;
  readonly contactEmail: string;
  readonly postalAddress: string;
}

export interface SenderInfoProvider {
  get(): Promise<SenderInfo | undefined>;
}

export interface SendRecordStore {
  hasSent(requestId: string): Promise<boolean>;
  markSent(requestId: string, kind: string, sentAt: Date): Promise<void>;
}

export interface AlertThrottle {
  tryAcquire(
    name: string,
    now: Date,
    intervalSeconds: number,
  ): Promise<boolean>;
}
