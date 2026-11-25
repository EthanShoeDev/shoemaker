import { Array as Arr, Effect, Equal } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { AuditTrail } from 'shoemaker-admin';
import { adminApi } from 'shoemaker-admin/server';

import { FlagsApi } from '../contract/flags.ts';
import type { FlagConfig } from '../core/flag-config.ts';
import {
  FlagChanged,
  FlagProjectNotFound,
  FlagUnreadable,
} from '../core/flag-errors.ts';
import { flagsProduct } from '../core/flag-product.ts';
import { type Flag, FlagProjects, FlagStore } from '../core/flag-store.ts';

const FIELDS = ['variants', 'defaultVariant', 'rules'] as const;

// What an update did, for the audit entry.
const describe = (before: FlagConfig, after: FlagConfig) => {
  const turned =
    before.enabled === after.enabled
      ? []
      : [after.enabled ? 'turned on' : 'turned off'];
  const changed = Arr.filter(
    FIELDS,
    (field) => !Equal.equals(before[field], after[field]),
  );
  return Arr.join(
    [
      ...turned,
      ...(Arr.isReadonlyArrayNonEmpty(changed)
        ? [`changed ${Arr.join(changed, ', ')}`]
        : []),
    ],
    '; ',
  );
};

const FlagsHandlers = HttpApiBuilder.group(FlagsApi, 'flags', (handlers) =>
  Effect.gen(function* () {
    const store = yield* FlagStore;
    const projects = yield* FlagProjects;

    const checkProject = (projectId: number) =>
      Arr.some(projects, (project) => project.id === projectId)
        ? Effect.void
        : Effect.fail(FlagProjectNotFound.make({ projectId }));

    const audit = Effect.fnUntraced(function* (
      projectId: number,
      flag: Flag,
      detail?: string,
    ) {
      const trail = yield* AuditTrail;
      const name = `${flag.key} of project ${projectId}`;
      yield* trail.target({ kind: 'flag', id: flag.id });
      yield* trail.detail(detail === undefined ? name : `${name}: ${detail}`);
    });

    return handlers
      .handle('list', ({ params }) =>
        Effect.andThen(
          checkProject(params.projectId),
          store.list(params.projectId),
        ),
      )
      .handle('get', ({ params }) =>
        Effect.andThen(
          checkProject(params.projectId),
          store.get(params.projectId, params.id),
        ),
      )
      .handle('create', ({ params, payload }) =>
        Effect.gen(function* () {
          yield* checkProject(params.projectId);
          const flag = yield* store.create(params.projectId, payload);
          yield* audit(params.projectId, flag);
          return flag;
        }),
      )
      .handle('update', ({ params, payload }) =>
        Effect.gen(function* () {
          yield* checkProject(params.projectId);
          const before = yield* store.get(params.projectId, params.id);
          if (before.version !== payload.version) {
            return yield* FlagChanged.make({ id: before.id });
          }
          if (before.config === null) {
            return yield* FlagUnreadable.make({ id: before.id });
          }
          if (Equal.equals(before.config, payload.config)) {
            yield* (yield* AuditTrail).nothingChanged;
            return before;
          }
          const after = yield* store.update(
            params.projectId,
            before.id,
            payload,
          );
          yield* audit(
            params.projectId,
            after,
            describe(before.config, payload.config),
          );
          return after;
        }),
      )
      .handle('remove', ({ params, query }) =>
        Effect.gen(function* () {
          yield* checkProject(params.projectId);
          const flag = yield* store.remove(
            params.projectId,
            params.id,
            query.version,
          );
          yield* audit(params.projectId, flag);
        }),
      );
  }),
);

export const FlagsLive = adminApi(FlagsApi, {
  product: flagsProduct.id,
  handlers: FlagsHandlers,
});
