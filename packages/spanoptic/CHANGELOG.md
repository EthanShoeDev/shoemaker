# shoemaker-spanoptic

## 0.0.3

### Patch Changes

- [`f243bc6`](https://github.com/EthanShoeDev/shoemaker/commit/f243bc6ba59ac703a1c2996ab422678ff2eb611b) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Moves to OpenTelemetry 3 and OpenTUI 0.8. The tracer provider now comes from
  `@opentelemetry/sdk-trace` (`TracerProvider`), which replaces the deprecated
  `@opentelemetry/sdk-trace-base`, with `@opentelemetry/resources` 3. Effect is
  4.1.1.

## 0.0.2

### Patch Changes

- [`ecdfb45`](https://github.com/EthanShoeDev/shoemaker/commit/ecdfb451f77bc5cfc5ba05d106561c7aea157aa1) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Move to Effect 4.1.0, and pin `@effect/platform-node-shared` alongside it so
  `bunx shoemaker` no longer crashes with "Cannot find module
  'effect/crypto/Aead'" when `@effect/platform-bun`'s `^` range resolves past
  the pinned `effect`. Generated repos now get Effect 4.1.0; foldkit apps will
  not build until foldkit supports it.
