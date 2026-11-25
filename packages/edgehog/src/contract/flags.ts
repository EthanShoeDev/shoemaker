import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import { Audited, RequiredPermissions } from 'shoemaker-admin';
import { AdminAuth } from 'shoemaker-admin/contract';

import { FlagConfig } from '../core/flag-config.ts';
import {
  FlagChanged,
  FlagKeyTaken,
  FlagLimitReached,
  FlagNotFound,
  FlagProjectNotFound,
  FlagTypeFixed,
  FlagUnreadable,
} from '../core/flag-errors.ts';
import { Flag, NewFlag } from '../core/flag-store.ts';

const ProjectId = Schema.NumberFromString.check(Schema.isInt());
const Version = Schema.NumberFromString.check(Schema.isInt());
const inProject = { projectId: ProjectId };
const byId = { ...inProject, id: Schema.String };

const READ = { flag: ['read'] };
const WRITE = { flag: ['write'] };

// A misspelt `share` left out would serve a rule to everybody.
const strict = { onExcessProperty: 'error' } as const;

const FlagsGroup = HttpApiGroup.make('flags')
  .add(
    HttpApiEndpoint.get('list', '/projects/:projectId/flags', {
      params: inProject,
      success: Schema.Array(Flag),
      error: FlagProjectNotFound,
    }).annotate(RequiredPermissions, READ),
  )
  .add(
    HttpApiEndpoint.get('get', '/projects/:projectId/flags/:id', {
      params: byId,
      success: Flag,
      error: [FlagProjectNotFound, FlagNotFound],
    }).annotate(RequiredPermissions, READ),
  )
  .add(
    HttpApiEndpoint.post('create', '/projects/:projectId/flags', {
      params: inProject,
      payload: NewFlag,
      success: Flag.pipe(HttpApiSchema.status('Created')),
      error: [FlagProjectNotFound, FlagKeyTaken, FlagLimitReached],
    })
      .annotate(HttpApi.PayloadParseOptions, strict)
      .annotate(RequiredPermissions, WRITE)
      .annotate(Audited, { action: 'flag.create' }),
  )
  .add(
    // A flag keeps its key, which decides who is in a share, and its type.
    HttpApiEndpoint.put('update', '/projects/:projectId/flags/:id', {
      params: byId,
      payload: Schema.Struct({ version: Schema.Int, config: FlagConfig }),
      success: Flag,
      error: [
        FlagProjectNotFound,
        FlagNotFound,
        FlagChanged,
        FlagTypeFixed,
        FlagUnreadable,
        FlagLimitReached,
      ],
    })
      .annotate(HttpApi.PayloadParseOptions, strict)
      .annotate(RequiredPermissions, WRITE)
      .annotate(Audited, { action: 'flag.update', targetKind: 'flag' }),
  )
  .add(
    HttpApiEndpoint.delete('remove', '/projects/:projectId/flags/:id', {
      params: byId,
      // The version the caller read.
      query: { version: Version },
      success: HttpApiSchema.NoContent,
      error: [FlagProjectNotFound, FlagNotFound, FlagChanged],
    })
      .annotate(RequiredPermissions, WRITE)
      .annotate(Audited, { action: 'flag.delete', targetKind: 'flag' }),
  );

export const FlagsApi = HttpApi.make('shoemaker-edgehog-flags')
  .add(FlagsGroup)
  .middleware(AdminAuth);
