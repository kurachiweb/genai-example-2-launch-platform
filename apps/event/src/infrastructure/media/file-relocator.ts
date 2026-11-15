import {
  desiredLocation,
  type MediaFileView,
  type MediaLocation,
} from '../../../lib/core/media/media-file.ts';
import {
  MEDIA_MESSAGE_LIMITS,
  PURGE_IMAGE_CACHE_MESSAGE,
} from '../../../lib/core/media/media-messages.ts';
import type {
  MediaFileStore,
  MediaObjectStore,
} from '../../../lib/core/media/ports.ts';
import type { MessagePublisher } from '../../../lib/workers/messaging/queue-publisher.ts';
import type { FileRelocator } from '../../application/media/ports.ts';

export interface MediaFileRelocatorDependencies {
  readonly files: MediaFileStore;
  readonly objects: MediaObjectStore;
  readonly publisher: MessagePublisher;
}

interface Move {
  readonly id: string;
  readonly objectKey: string;
  readonly from: MediaLocation;
  readonly to: MediaLocation;
}

// 削除待ちは物理削除が全バケットから消すため動かさない。保存未完了は受付が記録の保存先によらず画像用非公開バケットへ書き込むため、記録だけを先に動かすと隔離中の画像が公開側に残る。保存の完了後の食い違いは日次の保存先の照合が拾う
function planMove(file: MediaFileView): Move | undefined {
  if (file.eraseRequested || !file.stored) {
    return undefined;
  }
  const to = desiredLocation(file.storage, file.quarantineReasons);
  if (to === file.location) {
    return undefined;
  }
  return { id: file.id, objectKey: file.objectKey, from: file.location, to };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

// 写す→元を消す→パージを依頼する→記録を更新するの順で進め、記録を最後に更新するため、どの段階で失敗しても再試行が同じ手順を最後までやり直せる
export class MediaFileRelocator implements FileRelocator {
  private readonly files: MediaFileStore;
  private readonly objects: MediaObjectStore;
  private readonly publisher: MessagePublisher;

  constructor(dependencies: MediaFileRelocatorDependencies) {
    this.files = dependencies.files;
    this.objects = dependencies.objects;
    this.publisher = dependencies.publisher;
  }

  async reconcile(
    fileIds: readonly string[],
  ): Promise<{ readonly moved: number }> {
    const views = await this.files.findViews([...new Set(fileIds)]);
    const moves = [...views.values()].flatMap((file) => planMove(file) ?? []);
    const purgeKeys: string[] = [];
    for (const move of moves) {
      if (await this.place(move)) {
        await this.objects.delete(move.from, [move.objectKey]);
        if (move.from === 'images') {
          purgeKeys.push(move.objectKey);
        }
      }
    }
    // 画像用非公開バケットから消した後にパージすれば、配信がキャッシュの無効化の後に元の画像を取り直さない
    for (const objectKeys of chunk(
      purgeKeys,
      MEDIA_MESSAGE_LIMITS.purgeBatch,
    )) {
      await this.publisher.publish(PURGE_IMAGE_CACHE_MESSAGE, { objectKeys });
    }
    let moved = 0;
    for (const move of moves) {
      if (await this.files.updateLocation(move.id, move.from, move.to)) {
        moved += 1;
      }
    }
    return { moved };
  }

  // 目的の保存先に画像があれば真を返す。コピーは目的に既にあっても元の本文を読み出すため、先に有無を確かめて省く
  private async place(move: Move): Promise<boolean> {
    if (await this.objects.exists(move.to, move.objectKey)) {
      return true;
    }
    const copied = await this.objects.copy(move.from, move.to, move.objectKey);
    if (copied !== 'source-missing') {
      return true;
    }
    // 重複して配信された同じ移動が、確かめた後に写して元を消した場合も目的の保存先にある
    return this.objects.exists(move.to, move.objectKey);
  }
}
