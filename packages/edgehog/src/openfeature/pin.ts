import type { FlagDefinitionMap } from '../core/flag-store.ts';

// In an evaluation context, makes the evaluations that share it read one
// snapshot. A symbol, so it is no property a rule could name, and contexts
// that the SDK merges keep it.
export const PIN = Symbol('shoemaker-edgehog/openfeature/pin');

// By provider, since one client may ask several.
export type Pin = Map<object, Promise<FlagDefinitionMap | null>>;

export interface Pinned {
  readonly [PIN]?: Pin;
}
