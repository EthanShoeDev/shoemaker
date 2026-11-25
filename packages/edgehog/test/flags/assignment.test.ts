import { NodeServices } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Schema,
  String as Str,
} from 'effect';
import { Hex } from 'effect/encoding';

import { assignment, inShare } from '../../src/flags.ts';
import { sha1 } from '../../src/flags/sha1.ts';

const word = (value: number) => Str.padStart(8, '0')(value.toString(16));
const digest = (bytes: Uint8Array) => Arr.join(Arr.map(sha1(bytes), word), '');
const utf8 = (text: string) => new TextEncoder().encode(text);

// Another implementation to compare with.
const webDigest = (name: 'SHA-1' | 'SHA-256', bytes: Uint8Array<ArrayBuffer>) =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest(name, bytes)),
    (buffer) => Hex.encode(new Uint8Array(buffer)),
  );

describe('sha1', () => {
  it('gives the digests of RFC 3174', () => {
    const known = [
      ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
      [
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
      ],
      [Str.repeat(1_000_000)('a'), '34aa973cd4c4daa4f61eeb2bdbad27316534016f'],
      ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ] as const;
    for (const [input, expected] of known) {
      assert.strictEqual(digest(utf8(input)), expected);
    }
  });

  it.effect('agrees with another at every length around a block', () =>
    Effect.gen(function* () {
      for (let length = 0; length < 200; length += 1) {
        const bytes = Uint8Array.from({ length }, (_, at) => (at * 31) % 256);
        const expected = yield* webDigest('SHA-1', bytes);
        assert.strictEqual(digest(bytes), expected);
      }
    }),
  );
});

// Changing this, or the file, moves people between variants. Neither is ever
// right: a new way to assign needs a new name.
const VECTORS_SHA256 =
  '4dfd7cfd141435acecbc63ade620344887bacd16280c07ce64514d526689ce97';

const Vector = Schema.Tuple([
  Schema.String,
  Schema.String,
  Schema.Literals(['', 'variant']),
  Schema.Finite,
]);
const Vectors = Vector.pipe(Schema.Array, Schema.fromJsonString);
const decodeVectors = Schema.decodeEffect(Vectors);

const RolloutCheck = Schema.Struct({
  rollout_percentage: Schema.Finite,
  included: Schema.Boolean,
});
const Corpus = Schema.fromJsonString(
  Schema.Struct({
    vectors: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        prefix: Schema.String,
        identifier: Schema.String,
        salt: Schema.Literals(['', 'variant']),
        hash01: Schema.Finite,
        rollout_checks: RolloutCheck.pipe(Schema.Array, Schema.optional),
      }),
    ),
  }),
);
const decodeCorpus = Schema.decodeEffect(Corpus);

const readHere = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.readFileString(`${import.meta.dirname}/${file}`),
  );

describe('a share', () => {
  it('includes who is exactly at its edge', () => {
    const at = Arr.findFirst(
      Arr.makeBy(200, (n) => `id-${n}`),
      (id) => {
        const position = assignment('edge', id);
        return (position * 100) / 100 === position && position * 100 <= 100;
      },
    );
    const id = Option.getOrThrow(at);
    const edge = assignment('edge', id) * 100;
    assert.isTrue(inShare('edge', id, edge));
    assert.isFalse(inShare('edge', id, edge - 1e-9));
  });
});

it.layer(NodeServices.layer)('assignment', (it) => {
  it.effect('never changes', () =>
    Effect.gen(function* () {
      const file = yield* readHere('assignment.gen.json');
      const sum = yield* webDigest('SHA-256', utf8(file));
      assert.strictEqual(sum, VECTORS_SHA256);
      const vectors = yield* decodeVectors(file);
      assert.isAbove(vectors.length, 300);
      for (const [key, id, salt, expected] of vectors) {
        assert.strictEqual(assignment(key, id, salt), expected, `${key} ${id}`);
      }
    }),
  );

  it.effect('is what PostHog’s own vectors say', () =>
    Effect.gen(function* () {
      const file = yield* readHere('vendor/posthog/hash_sha1_60_v1.json');
      const { vectors } = yield* decodeCorpus(file);
      // Its holdouts have a prefix that is not a flag's key.
      const ours = Arr.filter(vectors, (vector) =>
        Str.endsWith('.')(vector.prefix),
      );
      assert.strictEqual(ours.length, vectors.length - 1);
      for (const vector of ours) {
        const key = Str.slice(0, -1)(vector.prefix);
        assert.strictEqual(
          assignment(key, vector.identifier, vector.salt),
          vector.hash01,
          vector.id,
        );
        for (const check of vector.rollout_checks ?? []) {
          assert.strictEqual(
            inShare(key, vector.identifier, check.rollout_percentage),
            check.included,
            `${vector.id} at ${check.rollout_percentage}%`,
          );
        }
      }
    }),
  );
});
