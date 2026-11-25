import type { Permissions } from '../core/annotations.ts';

export interface ProductNavEntry {
  readonly label: string;
  // Below wherever the host mounts the product's pages.
  readonly path: `/${string}`;
  // Who sees the entry.
  readonly permissions: Permissions;
}

export interface Product {
  readonly id: string;
  // Every permission its endpoints need.
  readonly statements: Permissions;
  readonly nav: ReadonlyArray<ProductNavEntry>;
}

// Keeps the literal types `defineAccess` builds its statements from.
export const defineProduct = <const P extends Product>(product: P) => product;
