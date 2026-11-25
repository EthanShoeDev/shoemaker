import type { FlagValue } from './flag-config.ts';

// As OpenFeature names them, and only those its remote evaluation protocol
// allows.
export type FlagReason = 'DISABLED' | 'SPLIT' | 'STATIC' | 'TARGETING_MATCH';

export type FlagErrorCode =
  | 'FLAG_NOT_FOUND'
  | 'GENERAL'
  | 'INVALID_CONTEXT'
  | 'PARSE_ERROR'
  | 'TARGETING_KEY_MISSING'
  | 'TYPE_MISMATCH';

export interface FlagMetadata {
  // Counts the changes made to the flag.
  readonly version: number;
}

export interface FlagMatch {
  readonly kind: 'value';
  readonly value: FlagValue;
  readonly variant: string;
  readonly reason: Exclude<FlagReason, 'DISABLED'>;
  readonly flagMetadata: FlagMetadata;
}

export type FlagResolution =
  | FlagMatch
  // No value, so the application's default applies.
  | {
      readonly kind: 'disabled';
      readonly reason: 'DISABLED';
      readonly flagMetadata: FlagMetadata;
    }
  | {
      readonly kind: 'error';
      readonly errorCode: FlagErrorCode;
      readonly errorMessage: string;
    };
