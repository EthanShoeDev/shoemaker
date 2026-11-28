# shoemaker-edgehog

## 0.1.1

### Patch Changes

- [`8569fe3`](https://github.com/EthanShoeDev/shoemaker/commit/8569fe3cadded6c21c1573195c39e4b530c920ef) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `shoemaker-edgehog`: feature flags. Typed flags with property rules and gradual
  rollouts, defined through an audited admin API, evaluated in process by an
  OpenFeature server provider. The package README has the whole setup.
  
  It needs `shoemaker-admin` mounted. To adopt it:
  
  1. Add `flagsProduct` to `defineAccess`, and grant `flag:read` and `flag:write`
     to
     any role but `admin` that needs them.
  2. Run `flagMigrations` before the server starts (`migrateHost` on Alchemy),
     on the app's own database.
  3. Mount `FlagsLive` beside the other admin products, with the projects the host
     declares.
  4. Register `edgehogProvider` where the server starts, or lazily on Workers.
  5. Put a feature behind a flag with the OpenFeature client. Its default in code
     is what everybody gets if the flag is missing, disabled or cannot be read.
  
  To undo it, revert the commit: code defaults apply.
- Updated dependencies [[`8569fe3`](https://github.com/EthanShoeDev/shoemaker/commit/8569fe3cadded6c21c1573195c39e4b530c920ef), [`8569fe3`](https://github.com/EthanShoeDev/shoemaker/commit/8569fe3cadded6c21c1573195c39e4b530c920ef)]:
  - shoemaker-admin@0.1.1
