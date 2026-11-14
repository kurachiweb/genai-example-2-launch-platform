import type {
  TurnstileInstance,
  TurnstileProps,
} from '@marsidev/react-turnstile';
import {
  type CSSProperties,
  type Ref,
  useEffect,
  useImperativeHandle,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';

interface FakeTurnstileRecord {
  readonly renderedProps: TurnstileProps[];
  resetCount: number;
  issuedCount: number;
  scriptInserted: boolean;
  scriptErrorHandler: (() => void) | undefined;
}

const record: FakeTurnstileRecord = {
  renderedProps: [],
  resetCount: 0,
  issuedCount: 0,
  scriptInserted: false,
  scriptErrorHandler: undefined,
};

export const FAKE_ERROR_CODE = '300010';

export function resetFakeTurnstile(): void {
  record.renderedProps.length = 0;
  record.resetCount = 0;
  record.issuedCount = 0;
  record.scriptInserted = false;
  record.scriptErrorHandler = undefined;
}

// ライブラリと同じく、スクリプトの要素を加えた最初のインスタンスの`scriptOptions.onError`だけを要素のerrorに結び、そのインスタンスが外れた後も残す
const insertScriptOnce = (props: TurnstileProps): void => {
  if (props.injectScript === false || record.scriptInserted) {
    return;
  }
  record.scriptInserted = true;
  record.scriptErrorHandler = props.scriptOptions?.onError;
};

export function failTurnstileScript(): void {
  record.scriptErrorHandler?.();
}

export function lastTurnstileProps(): TurnstileProps {
  const props = record.renderedProps.at(-1);
  if (props === undefined) {
    throw new Error('ウィジェットの部品が描画されていません。');
  }
  return props;
}

export function turnstileResetCount(): number {
  return record.resetCount;
}

const issueToken = (): string => {
  record.issuedCount += 1;
  return `turnstile-token-${String(record.issuedCount)}`;
};

const createInstance = (): TurnstileInstance => ({
  render: () => undefined,
  execute: () => undefined,
  reset: () => {
    record.resetCount += 1;
  },
  remove: () => undefined,
  getResponse: () => undefined,
  getResponsePromise: () => Promise.reject(new Error('未対応です。')),
  isExpired: () => false,
});

interface FakeTurnstileProps extends TurnstileProps {
  readonly ref?: Ref<TurnstileInstance | undefined>;
}

// ライブラリが`size: 'invisible'`の入れ物に付ける大きさ。入れ物の`style`はこの後に重ねる
const INVISIBLE_CONTAINER_STYLE: CSSProperties = {
  width: 0,
  height: 0,
  overflow: 'hidden',
};

const subscribeNothing = (): (() => void) => () => undefined;

// ポータルはサーバーの描画で使えないため、ライブラリと同じくサーバーでは入れ物だけを描き、操作のボタンはブラウザでだけ描く
const useIsBrowserRender = (): boolean =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

// `@marsidev/react-turnstile`の`Turnstile`の差し替え。Cloudflareへ通信せず、判定の結果をボタンの操作で起こす。入れ物はライブラリと同じ大きさと`style`で描き、ボタンは配置の検査を乱さないよう`body`の直下に描く
export function Turnstile({ ref, ...props }: FakeTurnstileProps) {
  useImperativeHandle(ref, createInstance, []);
  const isBrowserRender = useIsBrowserRender();
  useEffect(() => {
    record.renderedProps.push(props);
  });
  useEffect(() => {
    insertScriptOnce(props);
  });
  const sizeStyle =
    props.options?.size === 'invisible' ? INVISIBLE_CONTAINER_STYLE : {};
  return (
    <div
      id={props.id}
      data-testid="fake-turnstile"
      style={{ ...sizeStyle, ...props.style }}
    >
      {isBrowserRender
        ? createPortal(
            <div data-testid="fake-turnstile-controls">
              <button
                type="button"
                onClick={() => {
                  props.onSuccess?.(issueToken());
                }}
              >
                判定を成功させる
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onExpire?.(
                    `turnstile-token-${String(record.issuedCount)}`,
                  );
                }}
              >
                判定の期限を切らす
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onError?.(FAKE_ERROR_CODE);
                }}
              >
                判定を失敗させる
              </button>
              <button type="button" onClick={failTurnstileScript}>
                スクリプトの読み込みを失敗させる
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
