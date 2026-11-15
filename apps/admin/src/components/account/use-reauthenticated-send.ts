import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { useAdminViewerRefresh } from '../auth/use-admin-viewer-refresh.ts';
import type { ReauthenticationValues } from './account-form-schemas.ts';

const REAUTHENTICATION_FAILED_CODE = 'reauthentication_failed';

export interface ReauthenticatedSendOptions {
  // 成功がセッションを入れ替えるなど、本人確認の入力によらず成功の後にログイン中の管理者を取り直す操作
  readonly refreshOnSuccess: boolean;
}

export type ReauthenticatedSend = <T>(
  reAuthentication: ReauthenticationValues,
  action: () => Promise<T>,
  options: ReauthenticatedSendOptions,
) => Promise<T>;

const usesRecoveryCode = ({ secondFactor }: ReauthenticationValues): boolean =>
  'recoveryCode' in secondFactor;

// サーバーは本人確認が通った時点でリカバリコードを使用済みにし、その後の操作が失敗しても戻さない。同じ画面のリカバリコードの残数を古いまま残さないよう、リカバリコードで送った操作は、本人確認で拒否された時を除いて結果によらずログイン中の管理者を取り直させる
export function useReauthenticatedSend(): ReauthenticatedSend {
  const refreshViewer = useAdminViewerRefresh();
  return async (reAuthentication, action, { refreshOnSuccess }) => {
    const consumable = usesRecoveryCode(reAuthentication);
    try {
      const result = await action();
      if (refreshOnSuccess || consumable) {
        void refreshViewer();
      }
      return result;
    } catch (error) {
      const rejectedByReauthentication =
        error instanceof GraphQLClientError &&
        error.code === REAUTHENTICATION_FAILED_CODE;
      if (consumable && !rejectedByReauthentication) {
        void refreshViewer();
      }
      throw error;
    }
  };
}
