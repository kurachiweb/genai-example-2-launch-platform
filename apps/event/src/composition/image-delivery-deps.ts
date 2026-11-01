import type { ImageDeliveryDeps } from '../application/media/image-delivery.ts';
import { ImagesBindingTransformer } from '../infrastructure/media/images-binding-transformer.ts';
import { R2ImageSource } from '../infrastructure/media/r2-image-source.ts';
import type { EventEnv } from './env-schema.ts';

export const createImageDeliveryDeps = (env: EventEnv): ImageDeliveryDeps => ({
  source: new R2ImageSource(env.IMAGES_BUCKET),
  transformer: new ImagesBindingTransformer(env.IMAGES),
});
