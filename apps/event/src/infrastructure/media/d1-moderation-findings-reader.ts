import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { mediaFiles } from '../../../db/schema/media/media-files.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { ModerationFinding } from '../../../lib/core/media/media-file.ts';
import { toModerationFindings } from '../../../lib/workers/media/d1-media-file-store.ts';
import type { ModerationFindingsReader } from '../../application/media/ports.ts';

@injectable()
export class D1ModerationFindingsReader implements ModerationFindingsReader {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findingsOf(fileId: string): Promise<readonly ModerationFinding[]> {
    const [row] = await this.db
      .select({ detail: mediaFiles.moderationDetail })
      .from(mediaFiles)
      .where(eq(mediaFiles.id, fileId));
    return toModerationFindings(row?.detail);
  }
}
