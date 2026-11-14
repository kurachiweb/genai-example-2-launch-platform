import { useCallback, useState, useSyncExternalStore } from 'react';

const SECOND_MS = 1000;

interface ServerClock {
  readonly serverNow: (serverTime: string) => number;
}

// 閲覧者の時計のずれを補正するため、取得したサーバーの時刻を最初に読んだ時点の閲覧者の時計との差を、次の取得でサーバーの時刻が変わるまで使い続ける
const createServerClock = (): ServerClock => {
  let latest: {
    readonly serverTime: string;
    readonly offsetMs: number;
  } | null = null;
  return {
    serverNow: (serverTime) => {
      const now = Date.now();
      if (latest?.serverTime !== serverTime) {
        latest = { serverTime, offsetMs: Date.parse(serverTime) - now };
      }
      return now + latest.offsetMs;
    },
  };
};

// サーバー側の描画とハイドレーションの時刻はブラウザの時刻と食い違うため、残り時間はハイドレーションの後にだけ出す
const readOnServer = (): null => null;

const subscribeNothing = (): (() => void) => () => undefined;

// サーバーの時刻に合わせた終了の時刻までの残りの秒数(切り上げ、0で止まる)。runningが偽の間とサーバー側の描画ではnullを返して毎秒の更新を止める。0になった時の取り直しは持たない
export function useServerCountdown(
  target: string,
  serverTime: string,
  running: boolean,
): number | null {
  const [clock] = useState(createServerClock);
  const remainingMsOf = useCallback(
    (): number => Date.parse(target) - clock.serverNow(serverTime),
    [clock, target, serverTime],
  );

  const subscribe = useCallback(
    (notify: () => void): (() => void) => {
      if (!running) {
        return subscribeNothing();
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      // 表示する秒が変わる時刻に合わせて次の更新を予約し、1秒の間隔の誤差を積み重ねない
      const schedule = (): void => {
        const remaining = remainingMsOf();
        if (remaining <= 0) {
          return;
        }
        timer = setTimeout(
          () => {
            notify();
            schedule();
          },
          remaining % SECOND_MS || SECOND_MS,
        );
      };
      schedule();
      return () => {
        clearTimeout(timer);
      };
    },
    [running, remainingMsOf],
  );

  // 止めている間に取り直しで届いたサーバーの時刻も、動かし始めた時点ではなく届いた時点の差で補正するよう、runningによらず読むたびに差を記録する
  const read = useCallback((): number | null => {
    const remaining = remainingMsOf();
    return running ? Math.max(0, Math.ceil(remaining / SECOND_MS)) : null;
  }, [running, remainingMsOf]);

  return useSyncExternalStore(subscribe, read, readOnServer);
}
