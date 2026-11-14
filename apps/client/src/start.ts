import { createStart } from '@tanstack/react-start';

import { createFrontendStartOptions } from '../lib/start/start-options.ts';

export const startInstance = createStart(createFrontendStartOptions());
