import type {
  TurnstileInstance,
  TurnstileProps,
} from '@marsidev/react-turnstile';
import { type Ref, useEffect, useImperativeHandle } from 'react';

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

// `@marsidev/react-turnstile`の`Turnstile`の差し替え。Cloudflareへ通信せず、判定の結果をボタンの操作で起こす
export function Turnstile({ ref, ...props }: FakeTurnstileProps) {
  useImperativeHandle(ref, createInstance, []);
  useEffect(() => {
    record.renderedProps.push(props);
  });
  return (
    <div id={props.id} data-testid="fake-turnstile">
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
    </div>
  );
}
