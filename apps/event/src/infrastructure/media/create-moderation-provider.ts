import type { ModerationProvider } from '../../application/media/ports.ts';
import { RekognitionModerationProvider } from './rekognition-moderation-provider.ts';
import { StubModerationProvider } from './stub-moderation-provider.ts';

export interface EventModerationProviderEnv {
  readonly MODERATION_PROVIDER: 'rekognition' | 'stub';
  readonly MODERATION_REGION: string;
  readonly REKOGNITION_ACCESS_KEY_ID?: string;
  readonly REKOGNITION_SECRET_ACCESS_KEY?: string;
}

// リージョンは宛先のホスト名に埋め込むため、AWSのリージョン名の形だけを受け付けて別のホストへ送らないようにする
const REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

const isMissing = (value: string | undefined): boolean =>
  value === undefined || value === '';

function createRekognitionProvider(
  env: EventModerationProviderEnv,
  fetcher: typeof fetch,
): RekognitionModerationProvider {
  const accessKeyId = env.REKOGNITION_ACCESS_KEY_ID ?? '';
  const secretAccessKey = env.REKOGNITION_SECRET_ACCESS_KEY ?? '';
  const missingEnvNames = [
    ...(isMissing(accessKeyId) ? ['REKOGNITION_ACCESS_KEY_ID'] : []),
    ...(isMissing(secretAccessKey) ? ['REKOGNITION_SECRET_ACCESS_KEY'] : []),
  ];
  if (missingEnvNames.length > 0) {
    throw new Error(
      `画像の判定サービスに必要な設定がありません: ${missingEnvNames.join(', ')}`,
    );
  }
  if (!REGION_PATTERN.test(env.MODERATION_REGION)) {
    throw new Error(
      'MODERATION_REGIONは判定サービスのリージョン名(us-east-1など)で指定してください。',
    );
  }
  return new RekognitionModerationProvider({
    accessKeyId,
    secretAccessKey,
    region: env.MODERATION_REGION,
    fetcher,
  });
}

export function createModerationProvider(
  env: EventModerationProviderEnv,
  fetcher: typeof fetch,
): ModerationProvider {
  switch (env.MODERATION_PROVIDER) {
    case 'stub':
      return new StubModerationProvider();
    case 'rekognition':
      return createRekognitionProvider(env, fetcher);
  }
}
