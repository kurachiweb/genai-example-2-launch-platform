import type {
  TurnstileInstance,
  TurnstileProps,
} from '@marsidev/react-turnstile';
import {
  type CSSProperties,
  type Ref,
  useEffect,
  useImperativeHandle,
} from 'react';
import { createPortal } from 'react-dom';

interface FakeTurnstileRecord {
  readonly renderedProps: TurnstileProps[];
  resetCount: number;
  issuedCount: number;
}

const record: FakeTurnstileRecord = {
  renderedProps: [],
  resetCount: 0,
  issuedCount: 0,
};

export const FAKE_ERROR_CODE = '300010';

export function resetFakeTurnstile(): void {
  record.renderedProps.length = 0;
  record.resetCount = 0;
  record.issuedCount = 0;
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

// `@marsidev/react-turnstile`の`Turnstile`の差し替え。Cloudflareへ通信せず、判定の結果をボタンの操作で起こす。入れ物はライブラリと同じ大きさと`style`で描き、ボタンは配置の検査を乱さないよう`body`の直下に描く
export function Turnstile({ ref, ...props }: FakeTurnstileProps) {
  useImperativeHandle(ref, createInstance, []);
  useEffect(() => {
    record.renderedProps.push(props);
  });
  const sizeStyle =
    props.options?.size === 'invisible' ? INVISIBLE_CONTAINER_STYLE : {};
  return (
    <div
      id={props.id}
      data-testid="fake-turnstile"
      style={{ ...sizeStyle, ...props.style }}
    >
      {createPortal(
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
              props.onExpire?.(`turnstile-token-${String(record.issuedCount)}`);
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
          <button
            type="button"
            onClick={() => {
              props.scriptOptions?.onError?.();
            }}
          >
            スクリプトの読み込みを失敗させる
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
