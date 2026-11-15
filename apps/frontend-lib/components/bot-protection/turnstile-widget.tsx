import { Turnstile, type TurnstileProps } from '@marsidev/react-turnstile';
import { useRouter } from '@tanstack/react-router';
import {
  type CSSProperties,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { appRuntimeOf } from '../../start/router-context.ts';
import { BOT_CHECK_FAILED_MESSAGE } from '../../utilities/messages/bot-protection-messages.ts';
import { FormMessage } from '../form/form-message.tsx';
import { useTheme } from '../theme/use-theme.ts';
import {
  hasTurnstileScriptFailed,
  recordTurnstileScriptFailure,
  subscribeTurnstileScriptFailure,
} from './turnstile-script-failure.ts';
import type { TurnstileWidgetProps } from './use-turnstile-token.ts';

const OUT_OF_FLOW_STYLE: CSSProperties = { position: 'absolute' };

// 記録はブラウザのページの中だけのもので、要求の間で共有しないため、サーバーの描画とハイドレーションでは読まない
const readServerScriptFailure = (): boolean => false;

export function TurnstileWidget({
  action,
  status,
  widgetRef,
  onSuccess,
  onExpire,
  onError,
}: TurnstileWidgetProps) {
  const router = useRouter();
  const siteKey = appRuntimeOf(router.options.context).publicConfig
    .turnstileSiteKey;
  const { theme } = useTheme();
  const nonce = router.options.ssr?.nonce;
  const id = useId();
  const scriptFailed = useSyncExternalStore(
    subscribeTurnstileScriptFailure,
    hasTurnstileScriptFailed,
    readServerScriptFailure,
  );
  const notifyScriptFailure = useEffectEvent(onError);

  // スクリプトの要素のerrorは要素を加えた最初のインスタンスにしか届かないため、そのインスタンスも含めて、記録を読んだ時にだけ失敗を知らせる
  useEffect(() => {
    if (scriptFailed) {
      notifyScriptFailure();
    }
  }, [scriptFailed]);

  // スクリプトの読み込みはライブラリがマウント後に行い、defer・asyncで最初の描画を妨げない
  const scriptOptions = useMemo<NonNullable<TurnstileProps['scriptOptions']>>(
    () => ({
      nonce,
      defer: true,
      async: true,
      onError: recordTurnstileScriptFailure,
    }),
    [nonce],
  );

  return (
    <>
      {scriptFailed ? null : (
        <Turnstile
          id={id}
          ref={widgetRef}
          data-slot="turnstile-widget"
          siteKey={siteKey}
          // 期限切れの時は使用済みと同じくトークンの管理側が再実行するため、ウィジェット自身の更新は止める。配色が変わるとウィジェットは作り直されて判定をやり直すが、受け取り済みのトークンは有効なまま残す。`size: 'invisible'`はライブラリ独自の指定でTurnstileへは渡らず、入れ物を幅と高さ0で描く
          options={{
            action,
            refreshExpired: 'never',
            theme,
            size: 'invisible',
          }}
          scriptOptions={scriptOptions}
          // 幅と高さ0の入れ物も通常の流れに残ると置く側の`gap`・`space-y`の間隔を1つ余計に生むため、流れから外す
          style={OUT_OF_FLOW_STYLE}
          onSuccess={onSuccess}
          onExpire={onExpire}
          onError={onError}
        />
      )}
      {status === 'error' ? (
        <FormMessage role="alert">{BOT_CHECK_FAILED_MESSAGE}</FormMessage>
      ) : null}
    </>
  );
}
