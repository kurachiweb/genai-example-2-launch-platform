import { Turnstile, type TurnstileProps } from '@marsidev/react-turnstile';
import { useRouter } from '@tanstack/react-router';
import { useId, useMemo } from 'react';

import type { RouterContext } from '../../start/router-context.ts';
import { BOT_CHECK_FAILED_MESSAGE } from '../../utilities/messages/bot-protection-messages.ts';
import { FormMessage } from '../form/form-message.tsx';
import type { TurnstileWidgetProps } from './use-turnstile-token.ts';

type RuntimeContext = Pick<RouterContext, 'runtime'>;

// 共通部品はアプリのルーターの型を登録できず、ルーターの文脈が型の無い値になるため、実行時の値の入れ物を持つことを確かめてから使う
function runtimeContextOf(context: unknown): RuntimeContext {
  if (
    typeof context !== 'object' ||
    context === null ||
    !('runtime' in context)
  ) {
    throw new Error(
      'ルーターの文脈に実行時の値がありません。createRouterContextで作った文脈をルーターへ渡してください。',
    );
  }
  return context as RuntimeContext;
}

export function TurnstileWidget({
  action,
  status,
  widgetRef,
  onSuccess,
  onExpire,
  onError,
}: TurnstileWidgetProps) {
  const router = useRouter();
  const { runtime } = runtimeContextOf(router.options.context);
  const siteKey = runtime.get().publicConfig.turnstileSiteKey;
  const nonce = router.options.ssr?.nonce;
  const id = useId();

  // スクリプトの読み込みはライブラリがマウント後に行い、defer・asyncで最初の描画を妨げない
  const scriptOptions = useMemo<NonNullable<TurnstileProps['scriptOptions']>>(
    () => ({ nonce, defer: true, async: true, onError }),
    [nonce, onError],
  );

  return (
    <div data-slot="turnstile-widget" className="flex flex-col gap-2">
      <Turnstile
        id={id}
        ref={widgetRef}
        siteKey={siteKey}
        // 期限切れの時は使用済みと同じくトークンの管理側が再実行するため、ウィジェット自身の更新は止める
        options={{ action, refreshExpired: 'never' }}
        scriptOptions={scriptOptions}
        onSuccess={onSuccess}
        onExpire={onExpire}
        onError={onError}
      />
      {status === 'error' ? (
        <FormMessage role="alert">{BOT_CHECK_FAILED_MESSAGE}</FormMessage>
      ) : null}
    </div>
  );
}
