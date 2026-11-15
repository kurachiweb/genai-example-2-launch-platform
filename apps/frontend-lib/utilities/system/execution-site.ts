export type ExecutionSite = 'server' | 'browser';

// workerdとBunは大域に文書(document)を持たないため、文書の有無でサーバーかブラウザかを見分ける
export const currentExecutionSite = (
  scope: object = globalThis,
): ExecutionSite => ('document' in scope ? 'browser' : 'server');
