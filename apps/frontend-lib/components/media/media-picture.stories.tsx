import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { MediaPicture } from './media-picture.tsx';

const OBJECT_KEY = '0123456789abcdef'.repeat(2);

// 画像はカタログの公開の設定の画像配信のオリジン(ローカルのイベントサーバー)から読み、配信されていなければ読み込みの失敗のプレースホルダーになる
const meta = {
  title: 'メディア/MediaPicture',
  component: MediaPicture,
  args: {
    image: {
      objectKey: OBJECT_KEY,
      fallbackFormat: 'JPG',
      width: 1000,
      height: 1000,
    },
    display: { kind: 'square', size: 64 },
    alt: 'Pitch Notesのロゴ',
    placeholder: { label: 'Pitch Notes', seed: 'product-1' },
  },
} satisfies Meta<typeof MediaPicture>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Square: Story = {};

export const Avatar: Story = {
  args: {
    display: { kind: 'square', size: 32 },
    alt: 'サンプル太郎のプロフィール画像',
    placeholder: { label: 'サンプル太郎', seed: 'user-1' },
    className: 'rounded-full',
  },
};

export const Svg: Story = {
  args: {
    image: {
      objectKey: OBJECT_KEY,
      fallbackFormat: 'SVG',
      width: null,
      height: null,
    },
    display: { kind: 'square', size: 128 },
  },
};

export const Screenshot: Story = {
  args: {
    image: {
      objectKey: OBJECT_KEY,
      fallbackFormat: 'PNG',
      width: 1920,
      height: 1080,
    },
    display: { kind: 'screenshot', variant: 'thumb' },
    alt: 'Pitch Notesのスクリーンショット',
    loading: 'lazy',
  },
};

export const SquarePlaceholders: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {[
        { label: 'Pitch Notes', seed: 'product-1' },
        { label: '蹴球ノート', seed: 'product-2' },
        { label: '👨‍👩‍👧 Family', seed: 'product-3' },
        { label: 'ßtudio', seed: 'product-4' },
      ].map((placeholder) => (
        <MediaPicture
          key={placeholder.seed}
          {...args}
          image={null}
          alt={`${placeholder.label}のロゴ`}
          placeholder={placeholder}
        />
      ))}
      <MediaPicture
        {...args}
        image={null}
        display={{ kind: 'square', size: 32 }}
        className="rounded-full"
      />
      <MediaPicture
        {...args}
        image={null}
        display={{ kind: 'square', size: 128 }}
        className="rounded-lg"
      />
    </div>
  ),
};

export const Quarantined: Story = {
  args: {
    image: {
      objectKey: null,
      fallbackFormat: 'JPG',
      width: 1000,
      height: 1000,
    },
  },
};

export const ScreenshotUnavailable: Story = {
  args: {
    image: {
      objectKey: null,
      fallbackFormat: 'PNG',
      width: 1920,
      height: 1080,
    },
    display: { kind: 'screenshot', variant: 'thumb' },
    alt: 'Pitch Notesのスクリーンショット',
    className: 'w-full rounded-md',
  },
  render: (args) => (
    <div className="max-w-sm">
      <MediaPicture {...args} />
    </div>
  ),
};
