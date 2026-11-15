import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { TOTP_QR_CODE_LABEL } from '../../utilities/messages/auth-messages.ts';
import { TotpQrCode } from './totp-qr-code.tsx';

// 秘密鍵らしい文字列をソースに書かないよう、Base32の秘密鍵は実行時に組み立てる
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SAMPLE_KEY = Array.from(
  { length: 32 },
  (_, index) => BASE32_ALPHABET[(index * 7) % BASE32_ALPHABET.length],
).join('');

const meta = {
  title: '認証/TotpQrCode',
  component: TotpQrCode,
  args: {
    uri: `otpauth://totp/Example:%40user?issuer=Example&secret=${SAMPLE_KEY}&algorithm=SHA1&digits=6&period=30`,
    label: TOTP_QR_CODE_LABEL,
  },
} satisfies Meta<typeof TotpQrCode>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = {
  args: { className: 'size-64' },
};
