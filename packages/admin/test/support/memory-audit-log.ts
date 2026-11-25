import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Layer,
  Number as Num,
  Option,
  Ref,
} from 'effect';

import {
  type AuditEntry,
  AuditLog,
  AuditWriteFailed,
  InvalidCursor,
} from '../../src/index.ts';

// Makes every write fail, the way a store that is down does.
export class AuditOutage extends Context.Service<
  AuditOutage,
  Ref.Ref<boolean>
>()('shoemaker-admin/test/support/memory-audit-log/AuditOutage') {}

export const MemoryAuditLog = Layer.effect(
  AuditLog,
  Effect.gen(function* () {
    const outage = yield* AuditOutage;
    const entries = yield* Ref.make<ReadonlyArray<typeof AuditEntry.Type>>([]);
    return {
      record: Effect.fnUntraced(function* (entry) {
        if (yield* Ref.get(outage)) {
          return yield* AuditWriteFailed.make({ cause: 'down' });
        }
        const now = yield* DateTime.now;
        yield* Ref.update(entries, (all) =>
          Arr.prepend(all, {
            id: String(all.length),
            actorId: entry.actorId,
            actorEmail: entry.actorEmail,
            action: entry.action,
            targetKind: entry.target?.kind ?? null,
            targetId: entry.target?.id ?? null,
            targetUserId:
              entry.target?.kind === 'user' ? entry.target.id : null,
            detail: entry.detail,
            createdAt: now,
          }),
        );
      }),
      list: Effect.fnUntraced(function* ({ limit, cursor }) {
        const from = Option.getOrNull(
          Option.filter(Num.parse(cursor ?? '0'), Num.isNumber),
        );
        if (from === null) return yield* InvalidCursor.make({});
        const all = yield* Ref.get(entries);
        const items = Arr.take(Arr.drop(all, from), limit);
        return {
          items,
          nextCursor: from + limit < all.length ? String(from + limit) : null,
        };
      }),
    };
  }),
).pipe(Layer.provideMerge(Layer.effect(AuditOutage, Ref.make(false))));
