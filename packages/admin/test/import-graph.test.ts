import { NodeServices } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';
import { ChildProcess } from 'effect/process';
import {
  importsIn,
  type Rules,
  violations,
} from 'shoemaker-utils/testing/import-graph';

const rules: Rules = {
  index: {
    owns: ['index.ts', 'core/', 'product/description.ts'],
    entries: [],
    packages: ['effect'],
  },
  contract: {
    owns: ['contract.ts', 'contract/'],
    entries: ['index'],
    packages: ['effect'],
  },
  access: {
    owns: ['access.ts'],
    entries: ['index'],
    packages: [
      'effect',
      'better-auth/plugins/access',
      'better-auth/plugins/admin/access',
    ],
  },
  server: {
    owns: ['server.ts', 'server/', 'product/mount.ts'],
    entries: ['index', 'contract'],
    packages: ['effect'],
  },
  'better-auth': {
    owns: ['better-auth.ts', 'better-auth/'],
    entries: ['index'],
    packages: [
      'effect',
      'better-auth',
      '@alchemy.run/better-auth',
      // The whole of Alchemy is for deploying.
      'alchemy/RuntimeContext',
    ],
  },
  sql: {
    owns: ['sql.ts', 'sql/', 'product/atomic.ts', 'product/migrations.ts'],
    entries: ['index'],
    packages: ['effect'],
  },
  alchemy: {
    owns: ['alchemy.ts', 'alchemy/'],
    entries: ['index', 'sql'],
    packages: ['effect', 'alchemy'],
  },
};

const src = `${import.meta.dirname}/../src`;

// Files as a fixture package, walked like the real one.
const violationsOf = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    for (const name of Rec.keys(rules)) {
      yield* fs.writeFileString(path.join(root, `${name}.ts`), '');
    }
    for (const [file, content] of Rec.toEntries(files)) {
      const target = path.join(root, file);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, content);
    }
    return yield* violations(rules, root);
  }).pipe(Effect.scoped);

const Metafile = Schema.fromJsonString(
  Schema.Struct({
    outputs: Schema.Record(
      Schema.String,
      Schema.Struct({
        inputs: Schema.Record(
          Schema.String,
          Schema.Struct({ bytesInOutput: Schema.Finite }),
        ),
      }),
    ),
  }),
);
const decodeMetafile = Schema.decodeEffect(Metafile);

// The files whose code is in an entry's browser bundle.
const bundled = Effect.fnUntraced(function* (entry: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const out = yield* fs.makeTempDirectoryScoped();
  const metafile = path.join(out, 'meta.json');
  const built = yield* ChildProcess.make(
    'bun',
    [
      'build',
      path.join(src, `${entry}.ts`),
      '--target=browser',
      '--minify',
      `--outdir=${out}`,
      `--metafile=${metafile}`,
    ],
    { stdout: 'ignore', stderr: 'inherit' },
  ).pipe(Effect.flatMap((handle) => handle.exitCode));
  assert.strictEqual(Number(built), 0);
  const meta = yield* Effect.flatMap(
    fs.readFileString(metafile),
    decodeMetafile,
  );
  return Arr.flatMap(Rec.values(meta.outputs), (output) =>
    Rec.keys(Rec.filter(output.inputs, (input) => input.bytesInOutput > 0)),
  );
}, Effect.scoped);

const SERVER_CODE =
  /\/HttpServer|effect\/dist\/sql\/|\/alchemy\/|^node:|src\/(?:server|sql|better-auth|alchemy|product\/(?!description))|better-auth\/dist\/(?!plugins\/(?:admin\/)?access\/)/u;

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

  it.effect('fails on a deliberate violation', () =>
    Effect.gen(function* () {
      const found = yield* violationsOf({
        'index.ts': "export * from './core/a.ts';\n",
        'core/a.ts':
          "import { x } from '../sql/store.ts';\nimport type { y } from 'better-auth';\n",
        'sql/store.ts': "import {\n  SqlClient,\n} from 'effect/sql';\n",
        'contract.ts': "export * from './server/handlers.ts';\n",
        'server/handlers.ts': '',
        'server.ts': "const x = () => import('alchemy');\n",
        'access.ts': "import './stray/b.ts';\nimport 'better-auth';\n",
      });
      assert.sameMembers(found, [
        'index reaches sql/store.ts of sql',
        "index reaches 'better-auth' in core/a.ts",
        'contract reaches server/handlers.ts of server',
        "server reaches 'alchemy' in server.ts",
        'stray/b.ts belongs to no entry',
        "access reaches 'better-auth' in access.ts",
      ]);
    }),
  );

  for (const entry of ['index', 'contract', 'access']) {
    it.effect(`of ${entry} puts no server code in a browser bundle`, () =>
      Effect.gen(function* () {
        const files = yield* bundled(entry);
        assert.isAbove(files.length, 1);
        assert.deepStrictEqual(
          Arr.filter(files, (file) => SERVER_CODE.test(file)),
          [],
        );
      }),
    );
  }

  it.effect('of server would be noticed in one', () =>
    Effect.gen(function* () {
      const files = yield* bundled('server');
      assert.isTrue(Arr.some(files, (file) => SERVER_CODE.test(file)));
    }),
  );
});

describe('importsIn', () => {
  it('reads every form the formatter leaves', () => {
    assert.deepStrictEqual(
      importsIn(
        Arr.join(
          [
            "import 'a';",
            "import type { B } from 'b';",
            "import {\n  type C,\n} from 'c';",
            "import * as D from 'd';",
            "import e from 'e';",
            "export * from 'f';",
            "export type { G } from 'g';",
          ],
          '\n',
        ),
      ),
      [
        { specifier: 'a', typeOnly: false },
        { specifier: 'b', typeOnly: true },
        { specifier: 'c', typeOnly: false },
        { specifier: 'd', typeOnly: false },
        { specifier: 'e', typeOnly: false },
        { specifier: 'f', typeOnly: false },
        { specifier: 'g', typeOnly: true },
      ],
    );
  });
});
