import { pipe, Record as Rec, String as Str } from 'effect';

import { FIXED } from './scenarios.ts';

const fixed = new Set(FIXED);

// What every run makes anew becomes the same text in the same form, so a
// recording differs only where the SDK does. An id keeps its identity within
// its recording.
export const normalizer = () => {
  const seen = new Map<string, string>();
  const replaced = (id: string) => {
    if (fixed.has(id)) return id;
    const known = seen.get(id);
    if (known !== undefined) return known;
    const next = Str.padStart(id.length, '0')(String(seen.size + 1));
    seen.set(id, next);
    return next;
  };
  const withIds = (text: string) =>
    // oxlint-disable-next-line effecttsgo/prefer-effect-string -- each id has its own replacement, which String.replaceAll cannot do
    text.replaceAll(/\b(?:[0-9a-f]{32}|[0-9a-f]{16})\b/gu, replaced);
  return (text: string) =>
    pipe(
      text,
      // Before the ids: its digits look like one.
      Str.replaceAll(
        /("sample_rand":"|sentry-sample_rand=)[\d.e-]+/gu,
        '$10.5',
      ),
      withIds,
      Str.replaceAll(/\b1[6-9]\d{8}\.\d+\b/gu, '1700000000.5'),
      Str.replaceAll(/\b1[6-9]\d{11}\b/gu, '1700000000500'),
      Str.replaceAll(/\b1[6-9]\d{8}\b/gu, '1700000000'),
      Str.replaceAll(
        /\b20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/gu,
        '2023-11-14T22:13:20.500Z',
      ),
      // Counts the spans and logs of one millisecond.
      Str.replaceAll(/("sentry\.timestamp\.sequence":\{"value":)\d+/gu, '$10'),
    );
};

// Only what ingest could read. The rest is the runtime's.
const HEADERS = new Set([
  'authorization',
  'content-encoding',
  'content-type',
  'user-agent',
  'x-sentry-auth',
]);

export const keptHeaders = (headers: Readonly<Record<string, string>>) =>
  Rec.filter(headers, (_, name) => HEADERS.has(name));
