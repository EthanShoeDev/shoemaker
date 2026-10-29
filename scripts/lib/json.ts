import { Array as Arr, Predicate, Record as Rec } from 'effect';

// package.json and friends as plain objects: unknown keys are kept, so a
// read-modify-write round trip never drops fields.
export const readJsonObject = async (file: string) => {
  const raw: unknown = await Bun.file(file).json();
  if (!Predicate.isObject(raw)) throw new Error(`${file} is not a JSON object`);
  return raw;
};

export const stringRecord = (value: unknown): Record<string, string> =>
  Predicate.isObject(value)
    ? Rec.fromEntries(
        Arr.filter(Rec.toEntries(value), (entry): entry is [string, string] =>
          Predicate.isString(entry[1]),
        ),
      )
    : {};

export const writeJson = (file: string, value: unknown) =>
  Bun.write(file, `${JSON.stringify(value, null, 2)}\n`);
