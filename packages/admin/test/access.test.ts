import { assert, describe, it } from '@effect/vitest';

import { defineAccess } from '../src/access.ts';
import { auditProduct, defineProduct, usersProduct } from '../src/index.ts';
import { access } from './support/access.ts';

const flags = defineProduct({
  id: 'flags',
  statements: { flag: ['read', 'write'], user: ['tag'] },
  nav: [],
});

describe('defineAccess', () => {
  it('reads comma-separated roles, ignoring spaces', () => {
    assert.isTrue(access.can('host, admin', { user: ['ban'] }));
    assert.isTrue(access.can(['host', 'admin'], { user: ['ban'] }));
    assert.isFalse(access.can('host', { user: ['ban'] }));
    for (const none of ['', ' , ', null, undefined, 'nobody', 'Admin']) {
      assert.isFalse(access.can(none, { user: ['ban'] }), String(none));
    }
  });

  it('reads an empty role list as the default role, as Better Auth does', () => {
    const granted = defineAccess({
      products: [usersProduct],
      roles: { user: { user: ['list'] } },
    });
    for (const none of ['', ' , ', null, undefined]) {
      assert.isTrue(granted.can(none, { user: ['list'] }), String(none));
    }
  });

  it('needs one role to grant every permission', () => {
    const both = { user: ['list'], billing: ['grant'] } as const;
    assert.isFalse(access.can('lister, support', both));
    assert.isTrue(access.can('admin', both));
    assert.isFalse(access.can('support', { billing: ['read', 'grant'] }));
  });

  it('grants nothing for an empty requirement', () => {
    assert.isFalse(access.can('admin', {}));
    assert.isFalse(access.can('admin', { user: [] }));
  });

  it('is not confused by names every object has', () => {
    assert.isFalse(access.can('constructor', { user: ['ban'] }));
    assert.isFalse(access.rules.can(['admin'], { constructor: ['name'] }));
    assert.isFalse(access.rules.isAdmin(['toString', '__proto__']));
    assert.deepStrictEqual(access.rules.undefinedIn({ valueOf: ['x'] }), [
      'valueOf:x',
    ]);
  });

  it('grants the default admin role every product’s permissions', () => {
    const plain = defineAccess({
      products: [usersProduct, auditProduct, flags],
    });
    assert.isTrue(plain.can('admin', { flag: ['read', 'write'] }));
    assert.isTrue(plain.can('admin', { audit: ['list'] }));
    // Merged into Better Auth's resource of the same name.
    assert.isTrue(plain.can('admin', { user: ['tag', 'set-role'] }));
    assert.isFalse(plain.can('admin', { user: ['impersonate-admins'] }));
    assert.isFalse(plain.can('user', { user: ['list'] }));
    assert.deepStrictEqual(plain.adminRoles, ['admin']);
  });

  it('lets the project narrow or widen one resource of the admin role', () => {
    const narrowed = defineAccess({
      products: [flags],
      roles: {
        admin: { flag: ['read'], session: [] },
        editor: { flag: ['read', 'write'] },
      },
    });
    assert.isFalse(narrowed.can('admin', { flag: ['write'] }));
    assert.isTrue(narrowed.can('admin', { flag: ['read'] }));
    assert.isTrue(narrowed.can('admin', { user: ['ban'] }));
    assert.isFalse(narrowed.can('admin', { session: ['list'] }));
    assert.isTrue(narrowed.can('editor', { flag: ['write'] }));
  });

  it('counts a role as an admin role when it grants anything not public', () => {
    assert.sameMembers(access.adminRoles, [
      'admin',
      'support',
      'lister',
      'inviter',
      'allButList',
      'allButSetRole',
      'allButCreate',
      'allButSetPassword',
      'allButDelete',
      'promoter',
      'recruiter',
      'owner',
      'adminImpersonator',
    ]);
    assert.isFalse(access.rules.isAdmin(['user', 'host', 'unknown']));
    assert.isTrue(access.rules.isAdmin(['host', 'support']));
    assert.isTrue(access.rules.isPublic({ outing: ['host'] }));
    assert.isFalse(
      access.rules.isPublic({ outing: ['host'], billing: ['read'] }),
    );
  });

  it('knows its roles by name', () => {
    for (const role of ['user', 'admin', 'host', 'owner']) {
      assert.isTrue(access.rules.isRole(role), role);
    }
    for (const role of [
      '',
      'Admin',
      'constructor',
      'host,admin',
      '__proto__',
    ]) {
      assert.isFalse(access.rules.isRole(role), role);
    }
  });

  it('refuses a role that a stored list could not hold', () => {
    for (const role of ['a,b', ' a', 'a ', '']) {
      assert.throws(() => defineAccess({ roles: { [role]: {} } }), /role/u);
    }
  });

  it('gives Better Auth the same roles', () => {
    assert.isTrue(
      access.roles.support.authorize({ billing: ['grant'] }).success,
    );
    assert.isFalse(access.roles.user.authorize({ user: ['list'] }).success);
    assert.isFalse(
      access.roles.admin.authorize({ user: ['impersonate-admins'] }).success,
    );
  });

  it('knows which permissions nobody defined', () => {
    assert.deepStrictEqual(
      access.rules.undefinedIn({ billing: ['read', 'refund'], flag: ['read'] }),
      ['billing:refund', 'flag:read'],
    );
  });

  it('types permissions by what is defined', () => {
    assert.deepStrictEqual(access.requires({ billing: ['grant'] }), {
      billing: ['grant'],
    });
    // @ts-expect-error -- not an action of billing
    access.requires({ billing: ['refund'] });
    // @ts-expect-error -- not a resource
    access.requires({ flag: ['read'] });
    defineAccess({
      products: [flags],
      // @ts-expect-error -- not an action of flag
      roles: { editor: { flag: ['delete'] } },
    });
    defineAccess({
      // @ts-expect-error -- not a resource without the product
      roles: { editor: { flag: ['read'] } },
    });
    // Better Auth's own resources need no product.
    defineAccess({ roles: { helper: { user: ['set-password'] } } });
  });
});
