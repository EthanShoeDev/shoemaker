import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';

// Serves a product's routes under a prefix. Its own contract carries none, so
// a client takes the same prefix in its base URL. A host mounts a product once:
// Effect builds one layer once, so a second mount of it would add no routes.
export const mountAt =
  (prefix: `/${string}`) =>
  <A, E, R>(product: Layer.Layer<A, E, R>) =>
    Layer.provide(
      product,
      Layer.effect(
        HttpRouter.HttpRouter,
        Effect.map(HttpRouter.HttpRouter, (router) => router.prefixed(prefix)),
      ),
    );
