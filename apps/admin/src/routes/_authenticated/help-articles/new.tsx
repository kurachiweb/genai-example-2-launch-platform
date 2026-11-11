import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/help-articles/new')({
  loader: () => {
    throw notFound();
  },
});
