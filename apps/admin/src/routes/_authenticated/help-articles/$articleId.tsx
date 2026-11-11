import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authenticated/help-articles/$articleId',
)({
  loader: () => {
    throw notFound();
  },
});
