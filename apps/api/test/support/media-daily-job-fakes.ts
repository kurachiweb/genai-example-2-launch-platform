import type { MediaFileView } from '../../lib/core/media/media-file.ts';
import type {
  EraseCandidateQuery,
  EraseSummary,
  MediaEraser,
  MediaFileStore,
  ModerationRequeueQuery,
} from '../../lib/core/media/ports.ts';
import type { MessageContract } from '../../lib/core/messaging/message-contract.ts';
import type { MediaJobMessagePublisher } from '../../src/application/media/media-daily-jobs.ts';

export function fileIdOf(serial: number): string {
  return `01KA${String(serial).padStart(22, '0')}`;
}

// D1MediaFileStoreの日次の照会と同じ条件(期限は`<`、識別子の昇順で上限まで)を記録の一覧に当てはめる
export class InMemoryMediaFileStore {
  readonly eraseCandidateCalls: EraseCandidateQuery[] = [];
  readonly moderationRequeueCalls: ModerationRequeueQuery[] = [];
  readonly locationMismatchLimits: number[] = [];
  readonly failures: {
    eraseCandidates?: Error;
    moderationRequeue?: Error;
    locationMismatches?: Error;
  } = {};
  private readonly files = new Map<string, MediaFileView>();

  constructor(files: readonly MediaFileView[] = []) {
    for (const file of files) {
      this.files.set(file.id, file);
    }
  }

  ids(): string[] {
    return [...this.files.keys()].sort();
  }

  remove(ids: readonly string[]): void {
    for (const id of ids) {
      this.files.delete(id);
    }
  }

  asStore(): MediaFileStore {
    return {
      insertReceiving: notUsed,
      markStored: notUsed,
      findViews: notUsed,
      attach: notUsed,
      markDeleted: notUsed,
      markEraseRequested: notUsed,
      remove: notUsed,
      recordModeration: notUsed,
      addReasons: notUsed,
      removeReasons: notUsed,
      updateLocation: notUsed,
      findIdsOwnedBy: notUsed,
      findOwnerIds: notUsed,
      findOwnedImageIdsByReason: notUsed,
      findEraseCandidates: (input) => {
        this.eraseCandidateCalls.push({ ...input });
        return this.select(
          this.failures.eraseCandidates,
          (file) =>
            file.eraseRequested ||
            (file.deletedAt !== null &&
              file.deletedAt.getTime() < input.deletedBefore.getTime()) ||
            (!file.attached &&
              file.createdAt.getTime() <
                input.unattachedCreatedBefore.getTime()),
          input.limit,
        );
      },
      findModerationRequeueCandidates: (input) => {
        this.moderationRequeueCalls.push({ ...input });
        return this.select(
          this.failures.moderationRequeue,
          (file) =>
            file.deletedAt === null &&
            !file.eraseRequested &&
            (file.moderationStatus === 'undetermined' ||
              (file.moderationStatus === 'pending' &&
                file.createdAt.getTime() <
                  input.pendingCreatedBefore.getTime())),
          input.limit,
        );
      },
      findLocationMismatches: (limit) => {
        this.locationMismatchLimits.push(limit);
        return this.select(
          this.failures.locationMismatches,
          (file) =>
            file.storage === 'images' &&
            ((file.location === 'images' &&
              file.quarantineReasons.length > 0) ||
              (file.location === 'quarantine' &&
                file.quarantineReasons.length === 0)),
          limit,
        );
      },
      listQuarantined: notUsed,
    };
  }

  private select(
    failure: Error | undefined,
    matches: (file: MediaFileView) => boolean,
    limit: number,
  ): Promise<readonly string[]> {
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    return Promise.resolve(
      this.ids()
        .filter((id) => {
          const file = this.files.get(id);
          return file !== undefined && matches(file);
        })
        .slice(0, limit),
    );
  }
}

export class RecordingEraser implements MediaEraser {
  readonly calls: (readonly string[])[] = [];
  failure: Error | undefined;

  constructor(private readonly store: InMemoryMediaFileStore) {}

  erase(fileIds: readonly string[]): Promise<EraseSummary> {
    this.calls.push([...fileIds]);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    const existing = fileIds.filter((id) => this.store.ids().includes(id));
    this.store.remove(existing);
    return Promise.resolve({ erased: existing.length });
  }
}

export interface PublishedMessage {
  readonly type: string;
  readonly body: unknown;
}

export class RecordingPublisher implements MediaJobMessagePublisher {
  readonly published: PublishedMessage[] = [];
  readonly attempts: PublishedMessage[] = [];
  failWhen: ((message: PublishedMessage) => Error | undefined) | undefined;

  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
  ): Promise<string> {
    const message = { type: contract.type, body: contract.schema.parse(body) };
    this.attempts.push(message);
    const failure = this.failWhen?.(message);
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    this.published.push(message);
    return Promise.resolve(`message-${String(this.published.length)}`);
  }
}

function notUsed(): never {
  throw new Error('日次バッチのジョブでは呼ばれない');
}
