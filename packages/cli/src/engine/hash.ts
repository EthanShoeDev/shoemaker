// oxlint-disable-next-line effecttsgo/node-builtin-import -- fingerprints are computed in pure code (plan, nextLock); Effect's Crypto would make them effectful
import { createHash } from 'node:crypto';

export const sha256 = (content: string) =>
  createHash('sha256').update(content).digest('hex');
