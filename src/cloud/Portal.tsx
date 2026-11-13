import { useCallback, useEffect, useState, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { App } from "../app/App";
import type { Backup } from "../domain/model";
import { CloudDB, CloudWallet, type QueuedAward } from "./wallet";
import { projectUrl, rpc, snapshot, supabase, transport } from "./client";
const registry = `stamp-wallet-family:${projectUrl}`;
const modeKey = "stamp-wallet-mode";
function cachedIdentity(): string | undefined {
  try {
    return (
      JSON.parse(localStorage.getItem(registry) || "null") as {
        userId?: string;
      } | null
    )?.userId;
  } catch {
    return undefined;
  }
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "操作失敗，請重試";
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Portal() {
  const [mode, setMode] = useState(
    () => localStorage.getItem(modeKey) || "local",
  );
  const walletRef = useRef<CloudWallet | null>(null);
  const identityRef = useRef<string | undefined>(undefined);
  const [network, setNetwork] = useState(navigator.onLine);
  useEffect(() => {
    const changed = () => setNetwork(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [wallet, setWallet] = useState<CloudWallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("爸爸");
  const [token, setToken] = useState("");
  const changeMode = (value: string) => {
    setPassword("");
    localStorage.setItem(modeKey, value);
    setMode(value);
    setError("");
  };
  const run = async (fn: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(false);
    }
  };
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session);
        if (error) setError(error.message);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) {
        if (s || _event === "SIGNED_OUT") setPassword("");
        if (_event === "SIGNED_OUT") {
          localStorage.removeItem(registry);
          walletRef.current?.stop();
          walletRef.current = null;
          setWallet(null);
        }
        identityRef.current =
          s?.user.id || (!navigator.onLine ? cachedIdentity() : undefined);
        setSession(s);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const userId = session?.user.id || (!network ? cachedIdentity() : undefined);
  identityRef.current = mode === "cloud" ? userId : undefined;
  useEffect(() => {
    if (mode !== "cloud" || !userId) return;
    let active = true;
    let current: CloudWallet | undefined;
    const open = async () => {
      walletRef.current?.stop();
      walletRef.current = null;
      setWallet(null);
      setReady(false);
      setError("");
      try {
        let family;
        try {
          family = await transport(userId).current();
        } catch (e) {
          if (navigator.onLine) throw e;
          const saved = JSON.parse(
            localStorage.getItem(registry) || "null",
          ) as { userId: string; familyId: string } | null;
          if (!saved || saved.userId !== userId) throw e;
          const db = new CloudDB(
            `stamp-wallet-cloud:${encodeURIComponent(projectUrl)}:${userId}:${saved.familyId}`,
          );
          try {
            family = (await db.cloudInfo.get("main"))?.snapshot;
          } finally {
            db.close();
          }
          if (!family) throw e;
        }
        if (!active) return;
        if (family) {
          current = new CloudWallet(transport(userId), projectUrl, family);
          await current.initialize();
          if (!active || identityRef.current !== userId) {
            current.stop();
            return;
          }
          localStorage.setItem(
            registry,
            JSON.stringify({ userId, familyId: family.familyId }),
          );
          walletRef.current = current;
          setWallet(current);
        }
      } catch (e) {
        if (active) setError(message(e));
      } finally {
        if (active) setReady(true);
      }
    };
    void open();
    return () => {
      active = false;
      current?.stop();
      walletRef.current?.stop();
      walletRef.current = null;
      setWallet(null);
    };
  }, [mode, userId]);
  const adopt = async (value: unknown) => {
    const expected = userId;
    if (!expected || identityRef.current !== expected) return;
    const family = snapshot(value);
    const next = new CloudWallet(transport(expected), projectUrl, family);
    await next.initialize();
    if (identityRef.current !== expected) {
      next.stop();
      return;
    }
    walletRef.current?.stop();
    walletRef.current = next;
    localStorage.setItem(
      registry,
      JSON.stringify({ userId: expected, familyId: family.familyId }),
    );
    setWallet(next);
  };
  const logout = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    wallet?.stop();
    setWallet(null);
    localStorage.removeItem(registry);
    setSession(null);
  };
  if (mode === "local")
    return (
      <App
        onBusy={setBusy}
        controls={
          <aside className="panel">
            <button disabled={busy} onClick={() => changeMode("cloud")}>
              爸爸媽媽家庭同步
            </button>
            <p>本機紀錄會保留；首次使用可匯出備份，再匯入空白家庭。</p>
          </aside>
        }
      />
    );
  if (wallet && wallet.userId === userId)
    return (
      <App
        key={wallet.db.name}
        wallet={wallet}
        onBusy={setBusy}
        externalBusy={working}
        syncStatus={<CloudSummary wallet={wallet} />}
        controls={
          <>
            <CloudControls wallet={wallet} busy={busy || working} />
            {wallet.family.role === "owner" && (
              <DeleteFamily
                wallet={wallet}
                busy={busy || working}
                onWorking={setWorking}
                onDeleted={() => {
                  if (
                    identityRef.current !== wallet.userId ||
                    walletRef.current !== wallet
                  )
                    return;
                  wallet.stop();
                  walletRef.current = null;
                  setWallet(null);
                  localStorage.removeItem(registry);
                  setReady(true);
                  setError("");
                }}
              />
            )}
            <aside className="panel">
              <p>{session?.user.email || "離線家庭快取"}</p>
              <button
                disabled={busy || working}
                onClick={() => void run(logout)}
              >
                登出（保留此帳戶待同步項目）
              </button>
              <button
                disabled={busy || working}
                onClick={() => {
                  wallet.stop();
                  setWallet(null);
                  changeMode("local");
                }}
              >
                返回本機戶口
              </button>
              {error && <p role="alert">{error}</p>}
            </aside>
          </>
        }
      />
    );
  return (
    <main
      className="panel"
      style={{ maxWidth: 540, margin: "2rem auto", padding: "1rem" }}
    >
      <h1>爸爸媽媽家庭同步</h1>
      <p>各自登入，同一個印仔戶口。離線加印會先暫存，確認同步後才可使用。</p>
      {!supabase ? (
        <p>家庭同步尚未設定。請按 README 設定 Supabase 連線。</p>
      ) : !session ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!supabase) return;
              const { error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
              });
              if (error) {
                if (error.code === "invalid_credentials")
                  throw new Error("電郵或密碼不正確，請重新輸入");
                if (error.code === "email_not_confirmed")
                  throw new Error("帳戶尚未確認，請聯絡建立帳戶的家長");
                throw new Error("登入失敗，請檢查連線或稍後重試");
              }
              setPassword("");
            });
          }}
        >
          <label>
            電郵
            <input
              type="email"
              required
              value={email}
              disabled={working}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              disabled={working}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={working}>{working ? "登入中…" : "登入"}</button>
          <p>
            請使用家長預先建立的帳戶。忘記密碼時，請聯絡管理此家庭 Supabase
            專案的家長重設；此版本不寄送重設電郵。
          </p>
        </form>
      ) : !ready ? (
        <p role="status">正在讀取家庭…</p>
      ) : (
        <>
          <label>
            你的家長稱呼
            <input
              maxLength={100}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <button
            disabled={working || !label.trim()}
            onClick={() =>
              void run(async () =>
                adopt(
                  await rpc(session.user.id, "family_create", {
                    p_label: label.trim(),
                  }),
                ),
              )
            }
          >
            建立家庭
          </button>
          <label>
            另一位家長提供的邀請碼
            <input value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <button
            disabled={working || !label.trim() || !token.trim()}
            onClick={() =>
              void run(async () =>
                adopt(
                  await rpc(session.user.id, "family_join", {
                    p_token: token.trim(),
                    p_label: label.trim(),
                  }),
                ),
              )
            }
          >
            加入家庭
          </button>
          <button disabled={working} onClick={() => void run(logout)}>
            登出
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button disabled={working} onClick={() => changeMode("local")}>
        返回本機戶口
      </button>
    </main>
  );
}
function CloudControls({
  wallet,
  busy,
}: {
  wallet: CloudWallet;
  busy: boolean;
}) {
  const [pending, setPending] = useState<QueuedAward[]>([]);
  const [status, setStatus] = useState({ ...wallet.status });
  const [online, setOnline] = useState(navigator.onLine);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [last, setLast] = useState("");
  const refresh = useCallback(() => {
    if (navigator.onLine)
      void wallet.refresh().catch((e) => setError(message(e)));
  }, [wallet]);
  useEffect(() => {
    let active = true;
    const update = () => {
      setStatus({ ...wallet.status });
      void wallet.db.outbox.toArray().then((rows) => {
        if (active) setPending(rows);
      });
      void wallet.db.cloudInfo.get("main").then((info) => {
        if (active) setLast(info?.lastSynced || "");
      });
    };
    const unsub = wallet.subscribe(update);
    update();
    const onNetwork = () => {
      setOnline(navigator.onLine);
      refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(refresh, 15000);
    refresh();
    return () => {
      active = false;
      unsub();
      clearInterval(timer);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [wallet, refresh]);
  const act = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <aside className="panel">
      <h2>家庭同步</h2>
      <p>
        {online ? "已連線" : "離線"} ·{" "}
        {status.syncing
          ? "同步中…"
          : `待同步加印 ${pending.length} 個（未計入餘額）`}
      </p>
      <p>家長：{wallet.family.members.map((m) => m.label).join("、")}</p>
      {last && (
        <p>
          最近同步：
          {new Date(last).toLocaleString("zh-HK", {
            timeZone: "Asia/Hong_Kong",
          })}
        </p>
      )}
      <p>扣印、消費、更正及設定需要連線確認。</p>
      <button disabled={!online || status.syncing} onClick={refresh}>
        立即同步
      </button>
      {wallet.family.role === "owner" && (
        <button
          disabled={busy || !online}
          onClick={() =>
            void act(async () => {
              const user = (await supabase!.auth.getSession()).data.session
                ?.user.id;
              if (!user) throw Error("請重新登入");
              const value = await rpc(user, "family_invite");
              if (typeof value !== "string") throw Error("邀請回應格式錯誤");
              setInvite(value);
              await wallet.refresh();
            })
          }
        >
          產生一次性家庭邀請碼
        </button>
      )}
      {invite && (
        <label>
          邀請碼（24 小時內使用；只分享給另一位家長）
          <textarea readOnly value={invite} />
        </label>
      )}
      {pending.length > 0 && (
        <button
          onClick={() =>
            download(
              {
                project: projectUrl,
                familyId: wallet.family.familyId,
                pending,
              },
              `stamp-wallet-pending-${Date.now()}.json`,
            )
          }
        >
          匯出待同步項目
        </button>
      )}
      {pending
        .filter((p) => p.status === "blocked")
        .map((p) => (
          <div key={p.operationId}>
            <p>
              {p.input.reason}：{p.error}
            </p>
            <button
              disabled={!online || busy}
              onClick={() => void act(() => wallet.retryBlocked(p.operationId))}
            >
              重試
            </button>
            <button
              disabled={!online || busy}
              onClick={() => {
                if (
                  window.confirm("此項已被伺服器拒絕。確定放棄這個待同步加印？")
                )
                  void act(() => wallet.dismissBlocked(p.operationId));
              }}
            >
              放棄被拒絕項目
            </button>
          </div>
        ))}
      {(error || status.error) && <p role="alert">{error || status.error}</p>}
    </aside>
  );
}

function CloudSummary({ wallet }: { wallet: CloudWallet }) {
  const [text, setText] = useState("家庭同步準備中…");
  useEffect(() => {
    let active = true;
    const update = () => {
      void wallet.db.outbox.count().then((count) => {
        if (active)
          setText(
            `${navigator.onLine ? "已連線" : "離線"} · ${wallet.status.syncing ? "同步中…" : wallet.status.error ? "同步未完成，請到設定查看" : count ? `待同步加印 ${count} 個` : "每 15 秒自動同步"}`,
          );
      });
    };
    const unsubscribe = wallet.subscribe(update);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [wallet]);
  return <p role="status">{text}</p>;
}

function DeleteFamily({
  wallet,
  busy,
  onDeleted,
  onWorking,
}: {
  wallet: CloudWallet;
  busy: boolean;
  onDeleted: () => void;
  onWorking: (value: boolean) => void;
}) {
  const [preview, setPreview] = useState<Backup | null>(null);
  const [members, setMembers] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const [working, setLocalWorking] = useState(false);
  const setWorking = (value: boolean) => {
    setLocalWorking(value);
    onWorking(value);
  };
  const [error, setError] = useState("");
  const prepare = async () => {
    if (working || busy) return;
    setWorking(true);
    setError("");
    try {
      await wallet.refresh();
      if (await wallet.db.outbox.count())
        throw new Error("請先完成或處理待同步加印，才可刪除家庭");
      if (wallet.family.role !== "owner")
        throw new Error("只有建立家庭的家長可以刪除");
      setPreview(await wallet.exportBackup());
      setMembers(wallet.family.members.length);
      setConfirmation("");
      setSaved(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(false);
    }
  };
  const remove = async () => {
    if (!preview || working || busy || !saved || confirmation !== "刪除家庭")
      return;
    setWorking(true);
    setError("");
    let locked=false;
    try {
      if (!navigator.onLine) throw new Error("請連線後再刪除家庭");
      if (await wallet.db.outbox.count())
        throw new Error("出現待同步加印，請先處理並重新預覽");
      await wallet.beginDeletion();
      locked=true;
      await rpc(wallet.userId, "family_delete", {
        p_family_id: wallet.family.familyId,
        p_generation: preview.meta.datasetGeneration,
        p_revision: preview.meta.revision,
        p_confirmation: confirmation,
      });
      await wallet.completeDeletion();
      onDeleted();
    } catch (e) {
      if(locked)await wallet.cancelDeletion();
      setError(message(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <aside className="panel">
      <h2>刪除家庭</h2>
      <p>只刪除此雲端家庭，保留家長登入帳戶。刪除後可加入另一個家庭。</p>
      {!preview ? (
        <button disabled={busy || working} onClick={() => void prepare()}>
          預覽刪除家庭
        </button>
      ) : (
        <>
          <p>
            即將刪除「{preview.wallet.nickname}」的家庭：{members} 位家長、
            {preview.entries.length} 筆紀錄、餘額 {preview.wallet.balance}{" "}
            個印仔。
          </p>
          <p>
            所有家庭成員會被解除綁定，雲端交易、原因、設定及邀請碼將永久刪除，不會合併到其他家庭。請先通知其他家長停止操作，並處理各電話的待同步加印。其他裝置可能仍留有舊快取，請登出後重新登入。
          </p>
          <button
            disabled={working}
            onClick={() =>
              download(preview, `stamp-wallet-before-delete-${Date.now()}.json`)
            }
          >
            匯出刪除前備份
          </button>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={saved}
              disabled={working}
              onChange={(e) => setSaved(e.target.checked)}
            />
            我已保留所需備份，確認刪除此家庭及解除所有家長綁定
          </label>
          <label>
            輸入「刪除家庭」確認
            <input
              value={confirmation}
              disabled={working}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            disabled={busy || working || !saved || confirmation !== "刪除家庭"}
            onClick={() => void remove()}
          >
            {working ? "處理中…" : "永久刪除此家庭"}
          </button>
          <button
            disabled={working}
            onClick={() => {
              setPreview(null);
              setError("");
            }}
          >
            取消
          </button>
          <button disabled={working || busy} onClick={() => void prepare()}>
            重新預覽
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
