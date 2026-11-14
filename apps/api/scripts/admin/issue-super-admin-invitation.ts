import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ulid } from 'ulid';

import { CryptoSecretGenerator } from '../../src/infrastructure/auth/crypto-secret-generator.ts';
import {
  createCommandRunner,
  createTempSqlFiles,
  runSuperAdminInvitation,
  withoutPepper,
} from './super-admin-invitation.ts';

const API_DIR = resolve(import.meta.dirname, '..', '..');

const WRANGLER_BIN = join(API_DIR, 'node_modules', '.bin', 'wrangler');

process.exitCode = await runSuperAdminInvitation(process.argv.slice(2), {
  env: process.env,
  wrangler: createCommandRunner({
    bin: WRANGLER_BIN,
    cwd: API_DIR,
    env: withoutPepper(process.env),
  }),
  tempFiles: createTempSqlFiles(tmpdir()),
  secretGenerator: new CryptoSecretGenerator(),
  now: () => new Date(),
  newId: ulid,
  stdout: process.stdout,
  stderr: process.stderr,
});
