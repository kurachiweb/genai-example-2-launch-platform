import { AppError } from '../../../../lib/core/errors/app-error.ts';
import type { MessageContract } from '../../../../lib/core/messaging/message-contract.ts';
import type {
  ProductLifecycleCommand,
  ProductLifecycleCommitResult,
  ProductLifecycleCommitter,
  ProductMessagePublisher,
} from '../ports.ts';
import { PRODUCT_NOW, USER_ID } from './product-fakes.ts';

export const LIFECYCLE_PRODUCT_ID = '01JD0PRODUCT00000000000001';
export const LIFECYCLE_EVENT_ID = '01JD0EVENT0000000000000001';
export const MESSAGE_ID = '01JD0MESSAGE00000000000001';

export const committedResultOf = (
  type: ProductLifecycleCommand['type'],
  productId = LIFECYCLE_PRODUCT_ID,
): ProductLifecycleCommitResult => ({
  kind: 'committed',
  event: {
    id: LIFECYCLE_EVENT_ID,
    productId,
    ownerUserId: USER_ID,
    type,
    occurredAt: PRODUCT_NOW,
  },
});

export interface FakeLifecycleCommitter {
  readonly committer: ProductLifecycleCommitter;
  readonly commands: ProductLifecycleCommand[];
}

// resultを省くと、受け取った種類のイベントを確定したものとする
export function createFakeLifecycleCommitter(
  calls: string[],
  result?: ProductLifecycleCommitResult,
): FakeLifecycleCommitter {
  const commands: ProductLifecycleCommand[] = [];
  return {
    commands,
    committer: {
      commit(command) {
        calls.push('committer.commit');
        commands.push(command);
        return Promise.resolve(
          result ?? committedResultOf(command.type, command.productId),
        );
      },
    },
  };
}

export interface PublishedProductMessage {
  readonly type: string;
  readonly body: unknown;
}

export interface FakeProductMessagePublisher {
  readonly publisher: ProductMessagePublisher;
  readonly published: PublishedProductMessage[];
}

export function createFakeProductMessagePublisher(
  calls: string[],
  options: { readonly error?: Error } = {},
): FakeProductMessagePublisher {
  const published: PublishedProductMessage[] = [];
  return {
    published,
    publisher: {
      publish<TType extends string, TBody>(
        contract: MessageContract<TType, TBody>,
        body: TBody,
      ) {
        calls.push('publisher.publish');
        published.push({ type: contract.type, body });
        return options.error === undefined
          ? Promise.resolve(MESSAGE_ID)
          : Promise.reject(options.error);
      },
    },
  };
}

// AppError以外の例外(想定外の失敗)で拒否されたことを確かめ、その例外を返す
export async function unexpectedFailureOf(
  promise: Promise<unknown>,
): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error && !(error instanceof AppError)) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}
