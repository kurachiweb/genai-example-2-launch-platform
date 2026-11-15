export interface ReportableRoute {
  readonly options: {
    readonly loader?: unknown;
    readonly beforeLoad?: unknown;
    onError?: ((error: unknown) => void) | undefined;
  };
}

// ルートの定義はモジュールに1つで要求ごとのルーターが共有するため、2回目以降の呼び出しで包み直さない
const installedRouteOptions = new WeakSet<ReportableRoute['options']>();

// TanStack Routerにはルーター全体のloaderの失敗のフックが無く、onErrorは子のルートへ継承されないため、loaderかbeforeLoadを持つすべてのルートのonErrorで失敗を送る。onErrorは失敗の時にroute.optionsから読まれるため、定義を書き換えて補う
export function installRouteErrorReporting(
  routes: Iterable<ReportableRoute>,
  report: (error: unknown) => void,
): void {
  for (const route of routes) {
    const { options } = route;
    if (
      installedRouteOptions.has(options) ||
      (options.loader === undefined && options.beforeLoad === undefined)
    ) {
      continue;
    }
    installedRouteOptions.add(options);
    const routeOnError = options.onError;
    options.onError = (error: unknown): void => {
      report(error);
      routeOnError?.(error);
    };
  }
}
