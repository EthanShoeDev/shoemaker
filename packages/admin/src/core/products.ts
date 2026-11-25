import { defineProduct } from '../product/description.ts';

// `impersonate-admins` is Better Auth's, and the default admin role lacks it,
// so it is not among the product's own.
export const usersProduct = defineProduct({
  id: 'users',
  statements: {
    user: [
      'list',
      'get',
      'ban',
      'impersonate',
      'set-role',
      'create',
      'set-password',
      'delete',
    ],
  },
  nav: [{ label: 'Users', path: '/', permissions: { user: ['list'] } }],
});

export const auditProduct = defineProduct({
  id: 'audit',
  statements: { audit: ['list'] },
  nav: [
    { label: 'Audit log', path: '/audit', permissions: { audit: ['list'] } },
  ],
});
