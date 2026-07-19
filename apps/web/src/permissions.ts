import type { OrganizationRole } from "./types.js";

export function canManageProjects(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}

export function canManageKeys(role: OrganizationRole): boolean {
  return role !== "viewer";
}

export function canInvite(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}

export function canManageRoles(role: OrganizationRole): boolean {
  return role === "owner";
}

export function canAccessSettings(role: OrganizationRole): boolean {
  return role !== "viewer";
}
