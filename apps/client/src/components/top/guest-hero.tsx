import { Link } from '@tanstack/react-router';
import { RocketIcon } from 'lucide-react';
import { useId } from 'react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { LOGIN_LABEL } from '../auth/account-messages.ts';
import { HOME_HREF, SITE_NAME } from '../layout/site-links.ts';
import {
  GUEST_HERO_DESCRIPTION,
  GUEST_HERO_REGISTER_LABEL,
  GUEST_HERO_TITLE,
} from './top-page-messages.ts';

export function GuestHero() {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="relative mt-6 overflow-hidden rounded-2xl border border-primary/20 bg-primary text-primary-foreground"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_40px,var(--color-primary-foreground)_40px_80px)] opacity-[0.07]"
      />
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-6 sm:px-8">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-[0.2em] uppercase">
            {SITE_NAME}
          </p>
          <h2
            id={headingId}
            className="mt-1 text-2xl font-extrabold tracking-tight text-balance sm:text-3xl"
          >
            {GUEST_HERO_TITLE}
          </h2>
          <p className="mt-2 max-w-xl text-sm">{GUEST_HERO_DESCRIPTION}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            size="lg"
            className="bg-card text-foreground hover:bg-card/90"
          >
            <Link to="/auth/register">
              <RocketIcon aria-hidden="true" />
              {GUEST_HERO_REGISTER_LABEL}
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-primary-foreground/50 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Link to="/auth/login" search={{ redirect: HOME_HREF }}>
              {LOGIN_LABEL}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
