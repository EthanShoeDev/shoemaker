import { defineProduct } from 'shoemaker-admin';

export const flagsProduct = defineProduct({
  id: 'flags',
  statements: { flag: ['read', 'write'] },
  nav: [{ label: 'Flags', path: '/flags', permissions: { flag: ['read'] } }],
});
