// Runner-neutral task graph. Package scripts stay leaf commands
// (`oxlint -c ../../oxlint.config.ts .`); ordering and fan-out live here and are
// rendered to turbo.jsonc or nx.json, so switching runners is a re-render.

export interface TaskDef {
  // Task name, equal to the package.json script it runs (`typecheck`,
  // `oxlint:check`). Root-only tasks set `root: true` and run the root script.
  readonly name: string;
  readonly root?: boolean;
  // Restrict a package task override to one workspace package (`@scope/web`).
  // Rendered as a package-level turbo.jsonc / project.json target.
  readonly package?: string;
  // `^name` = same task in dependencies first; `name` = same package;
  // `//#name` = root task. Turbo syntax is the lingua franca; the nx renderer
  // translates it.
  readonly dependsOn?: ReadonlyArray<string>;
  // Tasks started alongside this one (turbo `with`). Aggregates like `lint`
  // and `lint:check` have no script of their own and only fan out.
  readonly with?: ReadonlyArray<string>;
  readonly inputs?: ReadonlyArray<string>;
  readonly outputs?: ReadonlyArray<string>;
  readonly cache?: boolean;
  readonly persistent?: boolean;
  readonly env?: ReadonlyArray<string>;
  // One-line reason rendered as a comment above the task.
  readonly comment?: string;
}
