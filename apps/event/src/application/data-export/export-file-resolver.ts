import { inject, injectable } from 'inversify';

import {
  chunk,
  IDS_PER_STATEMENT,
} from '../../../lib/core/d1/statement-chunks.ts';
import type { ExportFileView } from '../../../lib/core/data-export/export-snapshot.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';

// media-pipelineのファイルの記録から、ZIPの配置と除外の判定に要る項目だけをスナップショットの形へ写す
@injectable()
export class ExportFileResolver {
  constructor(
    @inject(MEDIA_TYPES.MediaFiles) private readonly files: MediaFiles,
  ) {}

  // 記録の無いファイルは返す写しに含めず、呼び出し側が格納できないファイルとして扱う
  async resolve(
    fileIds: readonly string[],
  ): Promise<ReadonlyMap<string, ExportFileView>> {
    const views = new Map<string, ExportFileView>();
    for (const ids of chunk([...new Set(fileIds)], IDS_PER_STATEMENT)) {
      const found = await this.files.findMany(ids);
      for (const [fileId, file] of found) {
        views.set(fileId, {
          fileId,
          originalFileName: file.originalFileName,
          contentType: file.contentType,
          byteSize: file.byteSize,
          quarantined: file.quarantined,
        });
      }
    }
    return views;
  }
}
