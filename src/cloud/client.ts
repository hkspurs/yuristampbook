import { createClient } from "@supabase/supabase-js";
import { validateBackup } from "../data/backup";
import { check } from "../domain/model";
import { CloudError, type CloudTransport, type FamilySnapshot } from "./types";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const projectUrl = url || "";
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
export function snapshot(value: unknown): FamilySnapshot {
  check(value !== null && typeof value === "object", "雲端回應格式錯誤");
  const s = value as FamilySnapshot;
  check(
    typeof s.familyId === "string" && ["owner", "parent"].includes(s.role),
    "家庭資料格式錯誤",
  );
  check(
    Array.isArray(s.members) &&
      s.members.every(
        (m) =>
          typeof m.userId === "string" &&
          typeof m.label === "string" &&
          ["owner", "parent"].includes(m.role),
      ),
    "成員資料格式錯誤",
  );
  return { ...s, backup: validateBackup(s.backup) };
}
export async function rpc(
  userId: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  check(supabase, "尚未設定家庭同步");
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError || auth.session?.user.id !== userId)
    throw new CloudError("登入已過期或變更，請重新登入");
  // Bind the verified identity to this exact request, even if another tab signs in.
  let response: Response;
  try {
    response = await fetch(`${projectUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: key!,
        Authorization: `Bearer ${auth.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw new CloudError("無法連接伺服器，請稍後重試", true);
  }
  const data: unknown = await response.json();
  if (!response.ok)
    throw new CloudError(
      typeof data === "object" && data && "message" in data
        ? String(data.message)
        : "伺服器拒絕操作",
      response.status >= 500,
    );
  const latest = await supabase.auth.getSession();
  if (latest.data.session?.user.id !== userId)
    throw new CloudError("登入已變更，請重新登入");
  return data;
}
export function transport(userId: string): CloudTransport {
  return {
    userId,
    async current() {
      const data = await rpc(userId, "family_current");
      return data === null ? null : snapshot(data);
    },
    async apply(operation) {
      return snapshot(
        await rpc(userId, "family_apply", { p_operation: operation }),
      );
    },
  };
}
