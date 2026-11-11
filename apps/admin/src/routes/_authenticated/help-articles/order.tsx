import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/help-articles/order')({
  loader: () => {
    throw notFound();
  },
});
