export type EncodableImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageFileOptions {
  readonly width: number;
  readonly height: number;
}

const SAMPLE_GRADIENT_STOPS = ['#0f766e', '#f59e0b'] as const;

export async function createImageFile(
  name: string,
  type: EncodableImageType,
  { width, height }: ImageFileOptions,
): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('見本の画像を描けません。');
  }
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, SAMPLE_GRADIENT_STOPS[0]);
  gradient.addColorStop(1, SAMPLE_GRADIENT_STOPS[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type });
  return new File([blob], name, { type });
}

export function createSvgFile(name: string): File {
  return new File(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#0f766e"/><circle cx="20" cy="20" r="12" fill="#f59e0b"/></svg>',
    ],
    name,
    { type: 'image/svg+xml' },
  );
}

export function createDocumentFile(
  name: string,
  type: string,
  bytes: number,
): File {
  return new File([new Uint8Array(bytes)], name, { type });
}
