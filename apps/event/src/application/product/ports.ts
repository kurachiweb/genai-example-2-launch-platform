import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleAsyncRegistration,
} from '../../../lib/core/product/product-lifecycle.ts';

export interface ProductLifecycleHandlerResolver {
  resolve(
    registration: ProductLifecycleAsyncRegistration,
  ): ProductLifecycleAsyncHandler;
}

export interface ProductPurgeStore {
  // 論理削除済みを含め、ロゴとスクリーンショット(表示順)のファイルのIDを返す。行が無ければundefined
  imageFileIds(productId: string): Promise<readonly string[] | undefined>;
  // 処理の記録・イベント・ローンチ・スクリーンショット・旧ハンドル・プロダクトを1つの一括の書き込みで物理削除する。行が無ければ何もしない
  purge(productId: string): Promise<void>;
}

// application層は共通ライブラリのworkersの送信部品を読み込めないため、PLATFORM_TYPES.MessagePublisherに束縛された部品をこの形で受け取る
export interface ProductMessagePublisher {
  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
  ): Promise<string>;
}
