import { Container } from 'inversify';

import {
  type Greeting,
  greetingModule,
  SMOKE_TYPES,
} from './fixtures/greeting.ts';

export default {
  fetch(): Response {
    const container = new Container({ defaultScope: 'Transient' });
    container.load(greetingModule);
    const greeting = container.get<Greeting>(SMOKE_TYPES.Greeting);
    return Response.json({ greeting: greeting.message() });
  },
} satisfies ExportedHandler;
