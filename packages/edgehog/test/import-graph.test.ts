import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  String as Str,
} from 'effect';
import { browserBundle } from 'shoemaker-utils/testing/browser-bundle';
import {
  importsIn,
  type Rules,
  violations,
} from 'shoemaker-utils/testing/import-graph';

const src = `${import.meta.dirname}/../src`;

const rules: Rules = {
  index: {
    owns: ['index.ts', 'core/', 'limits/'],
    entries: [],
    packages: ['effect', 'shoemaker-admin'],
  },
  contract: {
    owns: ['contract.ts', 'contract/'],
    entries: ['index'],
    packages: ['effect', 'shoemaker-admin'],
  },
  server: {
    owns: ['server.ts', 'server/'],
    entries: ['index', 'contract'],
    packages: ['effect', 'shoemaker-admin'],
  },
  sql: {
    owns: ['sql.ts', 'sql/'],
    entries: ['index'],
    packages: ['effect', 'shoemaker-admin'],
  },
  flags: {
    owns: ['flags.ts', 'flags/'],
    entries: ['index'],
    packages: ['effect', 'shoemaker-admin'],
  },
  openfeature: {
    owns: ['openfeature.ts', 'openfeature/'],
    entries: ['index', 'flags'],
    packages: ['effect', 'shoemaker-admin', '@openfeature/server-sdk'],
  },
};

// An entry may import the same entry of the admin, and what that one may.
const ADMIN: Readonly<Record<string, ReadonlyArray<string>>> = {
  contract: ['contract'],
  server: ['contract', 'server'],
  sql: ['sql'],
};

const SERVER_CODE =
  /\/HttpServer|effect\/dist\/sql\/|\/alchemy\/|^node:|(?:admin|edgehog)\/src\/(?:server|sql|better-auth|alchemy)|@openfeature/u;

it.layer(NodeServices.layer)('the import graph', (it) => {
  it.effect('of every entry holds only what its entry may import', () =>
    Effect.gen(function* () {
      const found = yield* violations(rules, src);
      assert.deepStrictEqual(found, []);
    }),
  );

  it.effect('covers every entry the package exports', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const files = yield* fs.readDirectory(src);
      assert.sameMembers(
        Arr.filter(files, Str.endsWith('.ts')),
        Arr.map(Rec.keys(rules), (name) => `${name}.ts`),
      );
    }),
  );

  it.effect('reaches the admin only through the same entry', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const files = yield* fs.readDirectory(src, { recursive: true });
      for (const file of Arr.filter(files, Str.endsWith('.ts'))) {
        const [top] = Str.split(/[./]/u)(file);
        const source = yield* fs.readFileString(path.join(src, file));
        for (const { specifier } of importsIn(source)) {
          const [name, entry] = Str.split(specifier, '/');
          if (name !== 'shoemaker-admin' || entry === undefined) continue;
          assert.include(ADMIN[top] ?? [], entry, `${file}: ${specifier}`);
        }
      }
    }),
  );

  it.effect('fails on a deliberate violation', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      for (const name of Rec.keys(rules)) {
        yield* fs.writeFileString(path.join(root, `${name}.ts`), '');
      }
      yield* fs.writeFileString(
        path.join(root, 'index.ts'),
        "export * from './flags.ts';\nimport '@openfeature/server-sdk';\n",
      );
      const found = yield* violations(rules, root);
      assert.sameMembers(found, [
        'index reaches flags.ts of flags',
        "index reaches '@openfeature/server-sdk' in index.ts",
      ]);
    }),
  );

  // Evaluating is safe in a browser too, though definitions never go there.
  for (const entry of ['index', 'contract', 'flags']) {
    it.effect(`of ${entry} puts no server code in a browser bundle`, () =>
      Effect.gen(function* () {
        const files = yield* browserBundle(`${src}/${entry}.ts`);
        assert.isAbove(files.length, 1);
        assert.deepStrictEqual(
          Arr.filter(files, (file) => SERVER_CODE.test(file)),
          [],
        );
      }),
    );
  }

  it.effect('of flags reaches nothing of error tracking or its storage', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const files = yield* fs.readDirectory(src, { recursive: true });
      for (const file of Arr.filter(files, (name) =>
        /^(?:flags|openfeature|sql\/flag|server\/flags|contract\/flags|core\/flag)/u.test(
          name,
        ),
      )) {
        if (!Str.endsWith('.ts')(file)) continue;
        const source = yield* fs.readFileString(path.join(src, file));
        for (const { specifier } of importsIn(source)) {
          assert.notMatch(specifier, /limits|ingest|event-store|analytics/u);
        }
      }
    }),
  );

  it.effect('of sql would be noticed in one', () =>
    Effect.gen(function* () {
      const files = yield* browserBundle(`${src}/sql.ts`);
      assert.isTrue(Arr.some(files, (file) => SERVER_CODE.test(file)));
    }),
  );
});
