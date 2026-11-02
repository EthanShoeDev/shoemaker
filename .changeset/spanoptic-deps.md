---
'shoemaker-spanoptic': patch
---

Moves to OpenTelemetry 3 and OpenTUI 0.8. The tracer provider now comes from
`@opentelemetry/sdk-trace` (`TracerProvider`), which replaces the deprecated
`@opentelemetry/sdk-trace-base`, with `@opentelemetry/resources` 3. Effect is
4.1.1.
