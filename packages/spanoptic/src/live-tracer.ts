import {
  Cause,
  Duration,
  Exit,
  Formatter,
  Function as Fn,
  Option,
  Predicate,
  Tracer,
} from 'effect';

import type { SpanEvent } from './trace.ts';

const toMillis = (nanos: bigint) => Duration.toMillis(Duration.nanos(nanos));

// Trace exports are JSON, so anything else (bigints, class instances) is text.
const attributeValue = (value: unknown) =>
  Predicate.isString(value) ||
  Predicate.isNumber(value) ||
  Predicate.isBoolean(value)
    ? value
    : Formatter.format(value);

// An interrupted span is not an error, as in Effect's own exporters.
const errorOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
    ? { message: Cause.prettyErrors(exit.cause)[0]?.message }
    : undefined;

type Emit = (event: SpanEvent) => void;

class LiveSpan extends Tracer.NativeSpan {
  readonly #emit: Emit;

  constructor(
    options: ConstructorParameters<typeof Tracer.NativeSpan>[0],
    emit: Emit,
  ) {
    super(options);
    // Unsampled, or below the minimum trace level: Effect's exporters skip it.
    this.#emit = this.sampled ? emit : Fn.constVoid;
    this.#emit({
      type: 'start',
      span: {
        spanId: this.spanId,
        ...Option.match(this.parent, {
          onNone: () => ({}),
          onSome: (parent) => ({ parentSpanId: parent.spanId }),
        }),
        name: this.name,
        startTime: toMillis(this.startTime),
        endTime: null,
        status: 'running',
        attributes: {},
        logs: [],
      },
    });
  }

  get #ended() {
    return Predicate.isTagged(this.status, 'Ended');
  }

  override attribute(key: string, value: unknown) {
    if (this.#ended) return;
    super.attribute(key, value);
    this.#emit({
      type: 'attribute',
      spanId: this.spanId,
      key,
      value: attributeValue(value),
    });
  }

  // A span ends once; a second `end` would overwrite what the TUI shows.
  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
    if (this.#ended) return;
    super.end(endTime, exit);
    const error = errorOf(exit);
    this.#emit({
      type: 'end',
      spanId: this.spanId,
      endTime: toMillis(endTime),
      status: error === undefined ? 'ok' : 'error',
      errorMessage: error?.message,
    });
  }
}

/** A tracer that reports each span's lifecycle as it happens. */
export const liveTracer = (emit: Emit) =>
  Tracer.make({ span: (options) => new LiveSpan(options, emit) });
