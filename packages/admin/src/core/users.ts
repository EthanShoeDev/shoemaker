import { Schema } from 'effect';

// Account data only: what a user means to a project (plans, usage, RSVPs)
// comes from the project's own endpoint, under its own permission.
export const AdminUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  roles: Schema.Array(Schema.String),
  banned: Schema.Boolean,
  banReason: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
});

export const AdminUserPage = Schema.Struct({
  items: Schema.Array(AdminUser),
  total: Schema.Int,
});

export const InvitedUser = Schema.Struct({
  user: AdminUser,
  // False when the account exists and its owner was sent nothing, so a password
  // link is still due.
  linkSent: Schema.Boolean,
});

// The optional operations a project declares.
export const UserOperations = Schema.Struct({
  invite: Schema.Boolean,
  passwordLink: Schema.Boolean,
  delete: Schema.Boolean,
});
