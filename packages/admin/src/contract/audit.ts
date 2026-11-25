import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';

import { RequiredPermissions } from '../core/annotations.ts';
import { AuditPage, InvalidCursor } from '../core/audit.ts';
import { AdminAuth } from './admin-auth.ts';

const AuditGroup = HttpApiGroup.make('audit').add(
  HttpApiEndpoint.get('list', '/audit', {
    query: {
      limit: Schema.optional(Schema.FiniteFromString),
      // A page's `nextCursor`.
      cursor: Schema.optional(Schema.String),
    },
    success: AuditPage,
    error: InvalidCursor,
  }).annotate(RequiredPermissions, { audit: ['list'] }),
);

export const AuditApi = HttpApi.make('shoemaker-admin-audit')
  .add(AuditGroup)
  .middleware(AdminAuth);
