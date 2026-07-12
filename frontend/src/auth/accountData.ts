import { supabase } from "./supabaseClient";

export interface AccountExport {
  export_version: number;
  exported_at: string;
  account: { id: string; email: string | null; created_at: string; last_sign_in_at: string | null };
  tables: Record<string, unknown[]>;
  storage_manifest: Array<Record<string, unknown>>;
  storage_note: string;
  anonymous_link_note?: string;
}

function appRoute(path: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${window.location.origin}${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function isAccountExport(value: unknown): value is AccountExport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const exportData = value as Record<string, unknown>;
  return exportData.export_version === 1
    && typeof exportData.exported_at === "string"
    && !!exportData.account
    && typeof exportData.account === "object"
    && !!exportData.tables
    && typeof exportData.tables === "object"
    && Array.isArray(exportData.storage_manifest);
}

export async function exportAccountData(): Promise<AccountExport> {
  const { data, error } = await supabase.functions.invoke("account-data", {
    body: { action: "export" },
  });
  if (error) throw error;
  if (!isAccountExport(data)) throw new Error("Invalid account export response");
  return data;
}

export function downloadAccountExport(data: AccountExport): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nonnos-table-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function deleteAccount(confirmation: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("account-data", {
    body: { action: "delete", confirmation },
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || (data as Record<string, unknown>).deleted !== true) {
    throw new Error("Account deletion was not confirmed");
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: appRoute("/update-password"),
  });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}
