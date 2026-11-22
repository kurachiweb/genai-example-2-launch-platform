import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';

// application層は共通ライブラリのworkersの送信部品を読み込めないため、PLATFORM_TYPES.MessagePublisherに束縛された部品をこの形で受け取る
export interface DataExportMessagePublisher {
  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
    options?: { readonly delaySeconds?: number },
  ): Promise<string>;
}

export interface DataExportRequestLimits {
  // 超過は種類rate_limited・コードrate_limit_exceededで再試行の秒数を持つAppErrorを投げる
  consume(userId: string): Promise<void>;
}
