import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 保有者のファイルを呼び出しのたびにD1から求め直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない。ファイルは外部キーを持たないため、消し切れるまで完了を返さないことで取り残しを検出する
@injectable()
export class OwnedFileErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(MEDIA_TYPES.MediaFiles) private readonly files: MediaFiles,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const { hasMore } = await this.files.eraseOwnedBy({
      kind: 'user',
      id: event.userId,
    });
    return hasMore ? CONTINUE : DONE;
  }
}
