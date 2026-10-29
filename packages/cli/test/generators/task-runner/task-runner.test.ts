import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  pipe,
  Predicate,
  Record as Rec,
  String as Str,
} from 'effect';
import { type ParseError, parse } from 'jsonc-parser';

import type { ShoemakerConfig } from '../../../src/config/schema.ts';
import type { GeneratedFile } from '../../../src/engine/types.ts';
import { parseRef } from '../../../src/generators/task-runner/refs.ts';
import { packageCommands } from '../../../src/generators/task-runner/tasks.ts';
import { parseJson, preset, record, render } from '../root/fixtures.ts';

const strings = (value: unknown) =>
  Arr.isArray(value) ? Arr.filter(value, Predicate.isString) : [];

const parseJsonc = (content: string) => {
  const errors: Array<ParseError> = [];
  const value: unknown = parse(content, errors, { allowTrailingComma: true });
  assert.deepStrictEqual(errors, []);
  return record(value);
};

const withRunner = (
  config: ShoemakerConfig,
  taskRunner: ShoemakerConfig['taskRunner'],
): ShoemakerConfig => ({ ...config, taskRunner });

const workspaceScripts = (files: ReadonlyArray<GeneratedFile>) =>
  pipe(
    files,
    Arr.filter((f) =>
      /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(f.path),
    ),
    Arr.map((f) => [f.path, record(parseJson(f).scripts)] as const),
  );

const configs = [
  ['minimal', preset('minimal')],
  ['web', preset('web')],
  ['full', preset('full')],
] as const;

describe.each(configs)('turbo.jsonc (%s preset)', (_name, base) => {
  const { files, byPath, file } = render(withRunner(base, 'turbo'));
  const tasks = record(parseJsonc(file('turbo.jsonc').content).tasks);
  const overrides = new Map(
    pipe(
      files,
      Arr.filter(
        (f) => f.path !== 'turbo.jsonc' && Str.endsWith('/turbo.jsonc')(f.path),
      ),
      Arr.map((f) => {
        const dir = Str.replace(/\/turbo\.jsonc$/u, '')(f.path);
        const name = record(parseJson(file(`${dir}/package.json`))).name;
        return [String(name), parseJsonc(f.content)] as const;
      }),
    ),
  );

  const defined = (ref: string) => {
    const parsed = parseRef(ref);
    if (parsed.kind === 'root') return `//#${parsed.task}` in tasks;
    if (parsed.kind === 'package') {
      return (
        parsed.task in tasks ||
        parsed.task in record(overrides.get(parsed.pkg)?.tasks)
      );
    }
    return parsed.task in tasks;
  };

  it('parses and has the shared settings', () => {
    const turbo = parseJsonc(file('turbo.jsonc').content);
    assert.strictEqual(turbo.ui, 'tui');
    assert.include(strings(turbo.globalPassThroughEnv), 'NIX_*');
    assert.include(file('turbo.jsonc').content, '// Task-inheritance pattern:');
    assert.isFalse(byPath.has('nx.json'));
  });

  it('only references defined tasks', () => {
    const all = [
      ...Rec.values(tasks),
      ...Arr.flatMap([...overrides.values()], (o) =>
        Rec.values(record(o.tasks)),
      ),
    ];
    const dangling = pipe(
      all,
      Arr.flatMap((task) => [
        ...strings(record(task).dependsOn),
        ...strings(record(task).with),
      ]),
      Arr.filter((ref) => !defined(ref)),
    );
    assert.deepStrictEqual(dangling, []);
  });

  it('fans lint:check out to the root checkers', () => {
    assert.include(
      strings(record(tasks['lint:check']).with),
      '//#lint:check:root',
    );
    const rootChecks = strings(record(tasks['//#lint:check:root']).with);
    for (const check of [
      '//#oxfmt:check',
      '//#knip:check',
      '//#catalog:check',
    ]) {
      assert.include(rootChecks, check);
    }
    assert.deepStrictEqual(
      Arr.every(
        strings(record(tasks['//#catalog:check']).inputs),
        Str.endsWith('package.json'),
      ),
      true,
    );
  });

  it('defines shared leaf commands once, run through bun', () => {
    const turbo = parseJsonc(file('turbo.jsonc').content);
    assert.deepStrictEqual(record(turbo.futureFlags), {
      experimentalTaskCommand: true,
    });
    for (const [name, argv] of Rec.toEntries(packageCommands)) {
      assert.deepStrictEqual(
        strings(record(tasks[name]).command),
        ['bun', 'run', ...argv],
        name,
      );
    }
    // A package script would override the command; only real overrides
    // (Expo's `clean`) remain.
    for (const [path, scripts] of workspaceScripts(files)) {
      for (const [name, argv] of Rec.toEntries(packageCommands)) {
        assert.notStrictEqual(scripts[name], Arr.join(argv, ' '), path);
      }
    }
  });

  it('extends the root config from package overrides', () => {
    for (const override of overrides.values()) {
      assert.deepStrictEqual(override.extends, ['//']);
    }
  });
});

describe.each(configs)('nx.json (%s preset)', (_name, base) => {
  const config = withRunner(base, 'nx');
  const { files, byPath, file } = render(config);
  const nx = parseJson(file('nx.json'));
  const defaults = record(nx.targetDefaults);
  const projectFiles = Arr.filter(files, (f) =>
    Str.endsWith('project.json')(f.path),
  );
  const projects = new Map(
    Arr.map(projectFiles, (f) => {
      const project = parseJson(f);
      return [String(project.name), record(project.targets)] as const;
    }),
  );

  it('parses and is shaped like nx 24 config', () => {
    assert.strictEqual(nx.$schema, './node_modules/nx/schemas/nx-schema.json');
    assert.isTrue(Arr.isArray(record(nx.namedInputs).default));
    assert.isFalse('transit' in defaults);
    assert.isFalse(byPath.has('turbo.jsonc'));
  });

  it('gives every workspace and the root a project.json', () => {
    const manifests = pipe(
      files,
      Arr.filter((f) =>
        /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(f.path),
      ),
      Arr.map((f) => Str.replace(/package\.json$/u, 'project.json')(f.path)),
    );
    for (const path of manifests) assert.isTrue(byPath.has(path), path);
    assert.isTrue(projects.has(config.name));
  });

  it('only depends on targets that exist', () => {
    const rootScripts = record(parseJson(file('package.json')).scripts);
    const rootTargets = projects.get(config.name) ?? {};
    const check = (target: unknown, inRoot: boolean) => {
      const deps: unknown = record(target).dependsOn;
      for (const dep of Arr.isArray(deps) ? deps : []) {
        if (Predicate.isString(dep)) {
          assert.isTrue(
            inRoot ? dep in rootTargets : dep in defaults,
            `self dependency ${dep}`,
          );
          continue;
        }
        const entry = record(dep);
        const name = String(entry.target);
        if (entry.dependencies === true) {
          assert.isTrue(name in defaults, `^${name}`);
        } else {
          for (const project of strings(entry.projects)) {
            const targets = projects.get(project);
            assert.isDefined(targets, project);
            assert.isTrue(name in (targets ?? {}), `${project}:${name}`);
          }
        }
      }
    };
    for (const target of Rec.values(defaults)) check(target, false);
    for (const [name, target] of Rec.toEntries(rootTargets)) {
      check(target, true);
      const entry = record(target);
      if (entry.executor === 'nx:run-script') {
        assert.isTrue(name in rootScripts, `root script ${name}`);
      } else {
        assert.strictEqual(entry.executor, 'nx:noop', name);
      }
    }
  });

  it('keeps shared leaf commands as package scripts', () => {
    assert.notInclude(file('nx.json').content, '"command"');
    for (const [path, scripts] of workspaceScripts(files)) {
      assert.strictEqual(scripts.typecheck, 'tsc --noEmit', path);
      assert.isDefined(scripts.test, path);
    }
  });

  it('models aggregates as nx:noop and stubs them in every project', () => {
    assert.strictEqual(record(defaults['lint:check']).executor, 'nx:noop');
    for (const [name, targets] of projects) {
      if (name !== config.name) assert.isTrue('lint:check' in targets, name);
    }
  });
});
