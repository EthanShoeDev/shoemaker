import { Array as Arr } from 'effect';

import { defineAccess } from '../../src/access.ts';
import { auditProduct, usersProduct } from '../../src/index.ts';

// Shaped like the React project: `host` is a role only its public app checks.
// Everything the users product needs but one.
const without = (missing: string) => ({
  user: Arr.filter(
    usersProduct.statements.user,
    (action) => action !== missing,
  ),
});

export const access = defineAccess({
  products: [usersProduct, auditProduct],
  statements: { billing: ['read', 'grant'], outing: ['host'] },
  roles: {
    host: { outing: ['host'] },
    support: { billing: ['grant'] },
    lister: { user: ['list', 'get'] },
    inviter: { user: ['list', 'create'] },
    allButList: without('list'),
    allButSetRole: without('set-role'),
    allButCreate: without('create'),
    allButSetPassword: without('set-password'),
    allButDelete: without('delete'),
    promoter: { user: ['set-role'] },
    recruiter: { user: ['create', 'set-role'] },
    owner: { user: ['impersonate', 'impersonate-admins'] },
  },
  publicStatements: { outing: ['host'] },
});
