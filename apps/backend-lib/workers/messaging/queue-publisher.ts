import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import type { MessageContract } from '../../core/messaging/message-contract.ts';
import type { Clock } from '../../core/time/clock.ts';

// Cloudflare Queuesが受け付ける遅延秒数の上限(12時間)
export const MAX_DELAY_SECONDS = 43_200;

export interface PublishOptions {
  readonly delaySeconds?: number;
}

export interface MessagePublisher {
  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
    options?: PublishOptions,
  ): Promise<string>;
}

export type MessagePublishFailureReason =
  'unknown-type' | 'invalid-body' | 'invalid-delay';

export class MessagePublishError extends Error {
  override readonly name = 'MessagePublishError';
  readonly reason: MessagePublishFailureReason;

  constructor(reason: MessagePublishFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

function isValidDelaySeconds(delaySeconds: number): boolean {
  return (
    Number.isInteger(delaySeconds) &&
    delaySeconds >= 0 &&
    delaySeconds <= MAX_DELAY_SECONDS
  );
}

export function createMessagePublisher(
  queue: Queue<QueueEnvelope>,
  contracts: readonly MessageContract<string, unknown>[],
  ids: IdGenerator,
  clock: Clock,
): MessagePublisher {
  const registeredContracts = new Map(
    contracts.map((contract) => [contract.type, contract]),
  );

  return {
    async publish(contract, body, options = {}) {
      const { type } = contract;
      const registered = registeredContracts.get(type);
      if (registered === undefined) {
        throw new MessagePublishError(
          'unknown-type',
          `メッセージの種別が集約点に登録されていません: ${JSON.stringify(type)}`,
        );
      }
      // 受信側は集約点の検証規則で本文を検証するため、送信側も同じ規則で検証し、規則に無いキーを除いた結果を送る。例外には検証の詳細(値を含み得る)を載せない
      const parsed = registered.schema.safeParse(body);
      if (!parsed.success) {
        throw new MessagePublishError(
          'invalid-body',
          `メッセージの本文が種別${JSON.stringify(type)}の検証規則に合いません`,
        );
      }
      const { delaySeconds } = options;
      if (delaySeconds !== undefined && !isValidDelaySeconds(delaySeconds)) {
        throw new MessagePublishError(
          'invalid-delay',
          `遅延秒数は0以上${String(MAX_DELAY_SECONDS)}以下の整数で指定してください: ${String(delaySeconds)}`,
        );
      }

      const envelope: QueueEnvelope = {
        v: 1,
        type,
        id: ids.generate(),
        sentAt: clock.now().toISOString(),
        body: parsed.data,
      };
      await queue.send(
        envelope,
        delaySeconds === undefined ? undefined : { delaySeconds },
      );
      return envelope.id;
    },
  };
}
