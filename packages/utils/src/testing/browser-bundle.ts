import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  Schema,
} from 'effect';
import { ChildProcess } from 'effect/process';

const Bundle = Schema.fromJsonString(
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

const decode = Schema.decodeEffect(Bundle);

// The files whose code a browser gets when it imports the entry. What nothing
// uses is left out, so a file here is one that cannot be.
export const browserBundle = (entry: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const outdir = yield* fs.makeTempDirectoryScoped();
    const report = path.join(outdir, 'report.json');
    const handle = yield* ChildProcess.make(
      'bun',
      ['build', entry, '--target=browser', '--minify', '--outdir', outdir]
        // Bun reads the metafile's path only as one argument.
        .concat(`--metafile=${report}`),
      { stdout: 'ignore', stderr: 'inherit' },
    );
    const code = yield* handle.exitCode;
    if (Number(code) !== 0) {
      return yield* Effect.die(new Error(`${entry} cannot be bundled.`));
    }
    const { outputs } = yield* Effect.flatMap(
      fs.readFileString(report),
      decode,
    );
    return Arr.flatMap(Rec.values(outputs), ({ inputs }) =>
      Rec.keys(Rec.filter(inputs, ({ bytesInOutput }) => bytesInOutput > 0)),
    );
  }).pipe(Effect.scoped);
