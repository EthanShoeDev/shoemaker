---
'shoemaker-spanoptic': patch
---

Spans come from an Effect `Tracer` instead of the OpenTelemetry SDK, which
drops `@effect/opentelemetry` and the three `@opentelemetry/*` packages.
Attributes set after a span starts now show in the details panel.
Spans Effect does not sample (`sampled: false`, below
`Tracer.MinimumTraceLevel`, or under such a span) are left out, and logs are no
longer also recorded as span events, which nothing read.
