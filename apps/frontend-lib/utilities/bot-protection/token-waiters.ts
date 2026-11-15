export interface TokenWaiters {
  wait(timeoutMs: number): Promise<string | undefined>;
  deliver(token: string): boolean;
  cancelAll(): void;
}

interface Waiter {
  readonly resolve: (token: string | undefined) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

// 待ちは届いた順に1つのトークンを1つだけ受け取り、同じトークンを2つの待ちへ渡さない
export function createTokenWaiters(): TokenWaiters {
  const queue: Waiter[] = [];

  const settle = (waiter: Waiter, token: string | undefined): void => {
    clearTimeout(waiter.timer);
    waiter.resolve(token);
  };

  return {
    wait: (timeoutMs) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          const index = queue.findIndex((waiter) => waiter.timer === timer);
          queue.splice(index, 1);
          resolve(undefined);
        }, timeoutMs);
        queue.push({ resolve, timer });
      }),
    deliver: (token) => {
      const waiter = queue.shift();
      if (waiter === undefined) {
        return false;
      }
      settle(waiter, token);
      return true;
    },
    cancelAll: () => {
      for (const waiter of queue.splice(0)) {
        settle(waiter, undefined);
      }
    },
  };
}
