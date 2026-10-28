import type { Meta, StoryObj } from '@storybook/tanstack-react';
import { fn } from 'storybook/test';

import {
  createNetworkError,
  GraphQLClientError,
} from '../../utilities/graphql/graphql-result.ts';
import type { SystemStatusResult } from '../../utilities/system/system-status-result.ts';
import { SystemStatusView } from './system-status-view.tsx';

const REACHABLE: SystemStatusResult = {
  ok: true,
  data: { serverTime: '2026-01-15T07:40:00.000Z', databaseReachable: true },
};

const RECHECKED: SystemStatusResult = {
  ok: true,
  data: { serverTime: '2026-01-15T07:52:00.000Z', databaseReachable: true },
};

const DATABASE_UNREACHABLE: SystemStatusResult = {
  ok: true,
  data: { serverTime: '2026-01-15T07:40:00.000Z', databaseReachable: false },
};

const API_UNREACHABLE: SystemStatusResult = {
  ok: false,
  error: new GraphQLClientError({
    code: 'upstream_unavailable',
    message: '現在ご利用いただけません。時間をおいて再度お試しください。',
    status: 502,
  }),
};

const NETWORK_ERROR: SystemStatusResult = {
  ok: false,
  error: createNetworkError(new TypeError('Failed to fetch')),
};

const INTERNAL_ERROR: SystemStatusResult = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: '予期しないエラーが発生しました。時間をおいて再度お試しください。',
    status: 500,
  }),
};

const meta = {
  title: '疎通確認/SystemStatusView',
  component: SystemStatusView,
  args: { server: REACHABLE, onRecheck: fn(), rechecking: false },
} satisfies Meta<typeof SystemStatusView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Reachable: Story = {};

export const DatabaseUnreachable: Story = {
  args: { server: DATABASE_UNREACHABLE },
};

export const ApiUnreachable: Story = {
  args: { server: API_UNREACHABLE },
};

export const UnexpectedError: Story = {
  args: { server: INTERNAL_ERROR },
};

export const Rechecking: Story = {
  args: { rechecking: true },
};

export const Rechecked: Story = {
  args: { browser: RECHECKED },
};

export const RecheckFailed: Story = {
  args: { browser: NETWORK_ERROR },
};
