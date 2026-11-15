import { createMiddleware } from '@tanstack/react-start';

const committedRequests = new WeakSet<Request>();

// TanStack Startは後続の処理が返した応答へ、その時点までに設定された応答の項目を合成して送り始める。合成の後に設定した項目は黙って失われるため、後続の処理が戻った時点で送り始めた後として記録する
export const responseCommitMiddleware = createMiddleware({
  type: 'request',
}).server(async ({ request, next }) => {
  try {
    return await next();
  } finally {
    committedRequests.add(request);
  }
});

export function isResponseCommitted(request: Request): boolean {
  return committedRequests.has(request);
}
