// What a Worker gets from its runtime, as far as these use it.
declare module 'cloudflare:workers' {
  import type { D1Client } from '@effect/sql-d1';

  export const env: { readonly DB: D1Client.D1ClientConfig['db'] };
  export const waitUntil: (running: Promise<unknown>) => void;
}
