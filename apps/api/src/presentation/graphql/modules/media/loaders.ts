import { MEDIA_TYPES } from '../../../../../lib/core/media/identifiers.ts';
import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../../../lib/core/media/ports.ts';
import { defineLoader } from '../../loaders.ts';

export const mediaFileLoader = defineLoader<string, MediaFileView | null>({
  name: 'mediaFile',
  batch: async (ids, scope) => {
    const files = await scope
      .resolve<MediaFiles>(MEDIA_TYPES.MediaFiles)
      .findMany(ids);
    return ids.map((id) => files.get(id) ?? null);
  },
});
