import { useEffect, useState } from 'react';

export type Countdown = {
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
};

const TICK_INTERVAL_MS = 1000;

export function getCountdown(target: Date, now: Date): Countdown {
  const remainingMs = target.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { hours: 0, minutes: 0, seconds: 0, done: true };
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: false,
  };
}

export function formatCountdown({
  hours,
  minutes,
  seconds,
}: Countdown): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// SSR時とクライアントのハイドレーション時で時刻がずれるため、マウント後(クライアントのみ)に計測を開始する
// getTargetは毎tick呼び直すため、目標時刻が現在時刻を基準に動く場合でも追従できる
// 同時に表示する複数のカウントダウンが1秒ずれないよう、次の更新は壁時計の秒境界に合わせて予約する
export function useCountdown(getTarget: () => Date): Countdown | null {
  const [countdown, setCountdown] = useState<Countdown | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = new Date();
      setCountdown(getCountdown(getTarget(), now));
      timeoutId = setTimeout(
        tick,
        TICK_INTERVAL_MS - (now.getTime() % TICK_INTERVAL_MS),
      );
    };
    tick();
    return () => clearTimeout(timeoutId);
  }, [getTarget]);

  return countdown;
}
