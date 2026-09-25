export function parsePermissions(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function hasPermission(role: string, permissionsJson: string, permission: string): boolean {
  // Both admin tiers have unconditional, full access to every permission-
  // gated feature by default ADMIN and SUPER_ADMIN never need
  // individual permissions granted, they're simply always authorized.
  // Every OTHER role (LEADER, or any custom role a super-admin creates
  // via Roles) is fully permission-driven: create the role, grant it
  // whatever permissions it needs, and exactly those permissions --
  // no more, no less govern what that account can do.
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  return parsePermissions(permissionsJson).includes(permission);
}

/** Shared by any controller that needs an "author/host, OR admin-tier
 * override" check the single place that defines what "admin-tier" means. */
export function isAdminTier(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
