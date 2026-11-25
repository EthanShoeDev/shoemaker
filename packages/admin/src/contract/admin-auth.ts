import { HttpApiMiddleware } from 'effect/http-api';

import type { AuditTrail } from '../core/audit.ts';
import type { CurrentAdmin } from '../core/caller.ts';
import { Forbidden, Unauthorized } from '../core/errors.ts';

// The check every admin endpoint runs behind. Middleware added to an API later
// wraps what was added before, so this one goes last: startup refuses one
// outside it, which would run before access is decided and could change a
// response already audited.
export class AdminAuth extends HttpApiMiddleware.Service<
  AdminAuth,
  { provides: CurrentAdmin | AuditTrail }
>()('shoemaker-admin/contract/admin-auth/AdminAuth', {
  error: [Unauthorized, Forbidden],
}) {}
