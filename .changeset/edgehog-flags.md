---
'shoemaker-edgehog': patch
---

`shoemaker-edgehog`: feature flags. Typed flags with property rules and gradual
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
