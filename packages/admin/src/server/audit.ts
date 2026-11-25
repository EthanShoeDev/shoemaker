import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';

import { AuditApi } from '../contract/audit.ts';
import { AuditLog } from '../core/audit.ts';
import { auditProduct } from '../core/products.ts';
import { adminApi } from './admin-api.ts';
import { pageSize } from './page-size.ts';

const ENTRIES = { initial: 50, maximum: 200 };

const AuditHandlers = HttpApiBuilder.group(AuditApi, 'audit', (handlers) =>
  Effect.gen(function* () {
    const log = yield* AuditLog;
    return handlers.handle('list', ({ query }) =>
      log.list({ limit: pageSize(query.limit, ENTRIES), cursor: query.cursor }),
    );
  }),
);

export const AuditLive = adminApi(AuditApi, {
  product: auditProduct.id,
  handlers: AuditHandlers,
});
