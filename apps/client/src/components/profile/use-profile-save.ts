import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { TurnstileTokenController } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { ClientUpdateMyProfileDocument } from '../../graphql/generated/graphql.ts';
import { myProfileQueryOptions } from '../../graphql/my-profile.ts';
import { PUBLIC_PROFILE_QUERY_PREFIX } from '../../graphql/public-profile.ts';
import { useViewerRefresh } from '../auth/use-viewer-refresh.ts';
import { PROFILE_SAVED_MESSAGE } from './profile-form-messages.ts';
import type { ProfileFormValues } from './profile-form-schema.ts';

export interface ProfileSaveTarget {
  readonly viewerId: string;
  // フォームを作った時点のハンドル。別の画面での変更を、サーバーが保存の時に競合として拒否するための版の値
  readonly expectedHandle: string;
}

export interface ProfileSaveState {
  readonly save: (
    values: ProfileFormValues,
    turnstile: TurnstileTokenController,
  ) => Promise<void>;
  // 保存に成功した時点のハンドル。公開プロフィールへの導線を作る
  readonly savedHandle: string | undefined;
  // 保存のたびに増え、保存した内容でフォームを作り直す鍵にする
  readonly savedCount: number;
}

// 保存に成功したら、取得済みの本人のプロフィールを保存の結果へ置き換え、公開プロフィールの取得済みの結果とヘッダーのユーザーメニューの元になる利用者の取得を捨てる。公開プロフィールは静的な取得のキャッシュのため、無効にするだけでは取り直されず、新しいハンドルで以前に得た「存在しない」の結果が残ってしまうので、取り除く
export function useProfileSave({
  viewerId,
  expectedHandle,
}: ProfileSaveTarget): ProfileSaveState {
  const queryClient = useQueryClient();
  const refreshViewer = useViewerRefresh();
  const updateProfile = useMutation(
    graphqlMutationOptions(ClientUpdateMyProfileDocument),
  );
  const [saved, setSaved] = useState<{
    readonly handle: string | undefined;
    readonly count: number;
  }>({ handle: undefined, count: 0 });

  const save = async (
    values: ProfileFormValues,
    turnstile: TurnstileTokenController,
  ): Promise<void> => {
    const { updateMyProfile } = await sendWithTurnstile(
      turnstile,
      (turnstileToken) =>
        updateProfile.mutateAsync({
          variables: { input: { ...values, expectedHandle } },
          turnstileToken,
        }),
    );
    queryClient.setQueryData(myProfileQueryOptions(viewerId).queryKey, {
      myProfile: updateMyProfile,
    });
    queryClient.removeQueries({ queryKey: PUBLIC_PROFILE_QUERY_PREFIX });
    notify.success(PROFILE_SAVED_MESSAGE);
    setSaved(({ count }) => ({
      handle: updateMyProfile.handle,
      count: count + 1,
    }));
    await refreshViewer();
  };

  return { save, savedHandle: saved.handle, savedCount: saved.count };
}
