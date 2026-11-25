---
'shoemaker-spanoptic': patch
---

Spans come from an Effect `Tracer` instead of the OpenTelemetry SDK, which
drops `@effect/opentelemetry` and the three `@opentelemetry/*` packages.
Attributes set after a span starts now show in the details panel.
