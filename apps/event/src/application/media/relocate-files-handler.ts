import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { RelocateFilesBody } from '../../../lib/core/media/media-messages.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import { EVENT_MEDIA_TYPES, type FileRelocator } from './ports.ts';

const logger = getAppLogger(['event', 'media', 'relocation']);

// 1件の失敗も例外のまま投げてメッセージ全体を再試行させる。保存先をそろえる処理は冪等で、処理済みのファイルは次の試行で何もしない
@injectable()
export class RelocateFilesHandler implements MessageHandler<RelocateFilesBody> {
  constructor(
    @inject(EVENT_MEDIA_TYPES.FileRelocator)
    private readonly relocator: FileRelocator,
  ) {}

  async handle(body: RelocateFilesBody): Promise<MessageHandlingResult> {
    const { moved } = await this.relocator.reconcile(body.fileIds);
    logger.info('保存先をそろえました', { files: body.fileIds.length, moved });
    return { kind: 'done' };
  }
}
