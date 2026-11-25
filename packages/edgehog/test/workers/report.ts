import { Schema } from 'effect';

const Timed = Schema.Struct({ body: Schema.String, millis: Schema.Finite });

const Interrupted = Schema.Struct({
  first: Schema.String,
  next: Timed,
  loads: Schema.String,
});

// What a Worker answered in each situation, every body as it was sent.
export const Report = Schema.fromJsonString(
  Schema.Struct({
    cold: Schema.Struct({
      answers: Schema.Array(Schema.String),
      page: Schema.String,
      loads: Schema.String,
    }),
    aborted: Interrupted,
    early: Interrupted,
    refresh: Interrupted,
    changed: Schema.Struct({
      before: Schema.String,
      within: Schema.String,
      after: Schema.Array(Schema.String),
      loads: Schema.String,
    }),
    output: Schema.String,
  }),
);
