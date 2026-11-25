---
'shoemaker': patch
---

Generated env vars and `shoemaker.lock.jsonc` sort by code unit instead of the
machine's locale. The next `shoemaker sync` reorders the lock once, and
`.env.schema` or `secretspec.toml` where the two orders differ
(`MOBILE_ANDROID_KEYSTORE` now comes before `MOBILE_ANDROID_KEY_ALIAS`); until
then `sync --check` can report those files as drift.
