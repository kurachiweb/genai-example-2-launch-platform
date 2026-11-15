import type { Meta, StoryObj } from '@storybook/tanstack-react';

import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import { ResultNotice } from '../feedback/result-notice.tsx';
import { LinkConfirmation } from './link-confirmation.tsx';

const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';

const meta = {
  title: '認証/LinkConfirmation',
  component: LinkConfirmation<string>,
  args: {
    description:
      'ボタンを押すと、メールアドレスの変更が完了します。ほかの端末ではログアウトします。',
    actionLabel: 'メールアドレスの変更を確定する',
    confirm: () => Promise.resolve('メールアドレスを変更しました。'),
    renderSuccess: (message: string) => (
      <ResultNotice tone="success" message={message} />
    ),
    invalidLinkMessage: INVALID_LINK_MESSAGE,
    invalidLinkGuide: <p>もう一度手続きを行ってください。</p>,
    failureMessageOf: () =>
      '通信に失敗しました。時間をおいて再度お試しください。',
  },
  parameters: {
    tanstack: { router: { path: '/#token=story' } },
  },
} satisfies Meta<typeof LinkConfirmation<string>>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const InvalidLink: Story = {
  args: {
    confirm: () =>
      Promise.reject(
        new GraphQLClientError({
          code: 'invalid_link',
          message: INVALID_LINK_MESSAGE,
          status: 422,
        }),
      ),
  },
};

export const Failure: Story = {
  args: {
    confirm: () =>
      Promise.reject(
        new GraphQLClientError({
          code: 'network_error',
          message: '通信に失敗しました。',
          status: 0,
        }),
      ),
  },
};
