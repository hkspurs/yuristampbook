import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { liveQuery } from "dexie";
import { useRegisterSW } from "virtual:pwa-register/react";
import { WalletDB, WalletService } from "../data/wallet";
import {
  clean,
  displayTime,
  hkInput,
  hkToUtc,
  labels,
  positiveInteger,
  type Category,
  type Entry,
  type Intent,
  type Reason,
} from "../domain/model";
export const localService = new WalletService(new WalletDB());
import type { WalletPort } from "../data/port";
const WalletContext = createContext<WalletPort>(localService);
const useWallet = () => useContext(WalletContext);
export function App({
  wallet = localService,
  controls,
  syncStatus,
  onBusy,
  externalBusy = false,
}: {
  wallet?: WalletPort;
  controls?: ReactNode;
  syncStatus?: ReactNode;
  onBusy?: (busy: boolean) => void;
  externalBusy?: boolean;
}) {
  return (
    <WalletContext.Provider value={wallet}>
      <WalletScreen
        controls={controls}
        syncStatus={syncStatus}
        onBusy={onBusy}
        externalBusy={externalBusy}
      />
    </WalletContext.Provider>
  );
}
type State = Awaited<ReturnType<WalletService["load"]>>;
const message = (e: unknown) =>
  e instanceof Error ? e.message : "未能儲存，請保留輸入並重試。";
function Icon({
  name = "star",
  ...props
}: {
  name?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      {...props}
    >
      {name === "star" ? (
        <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
      ) : name === "minus" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M7 12h10" />
        </>
      ) : name === "gift" ? (
        <>
          <path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13" />
          <path d="M12 7C3 7 6 0 10 4l2 3c9 0 6-7 2-3Z" />
        </>
      ) : name === "history" ? (
        <>
          <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l4 2" />
        </>
      ) : name === "settings" ? (
        <>
          <path d="M4 7h16M4 17h16" />
          <circle cx="9" cy="7" r="3" />
          <circle cx="16" cy="17" r="3" />
        </>
      ) : (
        <path d="M6 12h12m-5-5 5 5-5 5" />
      )}
    </svg>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <header className="dialog-header">
        <h2>{title}</h2>
        <button className="quiet" onClick={onClose} aria-label="關閉表單">
          關閉
        </button>
      </header>
      {children}
    </dialog>
  );
}
function PwaNotice({ blocked }: { blocked: boolean }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [reloadReady, setReloadReady] = useState(false);
  const {
    needRefresh: [refresh, setRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload() {
      setReloadReady(true);
    },
    onOfflineReady() {
      setReady(true);
    },
    onRegisteredSW(_url, registration) {
      if (registration?.active) setReady(true);
    },
    onRegisterError() {
      setError("離線準備未完成，請連線後重新開啟。");
    },
  });
  return (
    <>
      <p className="connection" role="status">
        {ready ? "已可離線使用" : error || "正在準備離線使用…"}
      </p>
      {(refresh || reloadReady) && (
        <aside className="notice">
          <p>有新版本，重新開啟更新</p>
          {blocked && <p>請先完成或關閉表單，再更新。</p>}
          <button
            disabled={blocked}
            onClick={() => {
              if (reloadReady) location.reload();
              else void updateServiceWorker(true);
            }}
          >
            立即更新
          </button>
          <button
            className="quiet"
            onClick={() => {
              setRefresh(false);
              setReloadReady(false);
            }}
          >
            稍後處理
          </button>
        </aside>
      )}
    </>
  );
}
function WalletScreen({
  controls,
  syncStatus,
  onBusy,
  externalBusy,
}: {
  controls?: ReactNode;
  syncStatus?: ReactNode;
  onBusy?: (busy: boolean) => void;
  externalBusy: boolean;
}) {
  const service = useWallet();
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [page, setPage] = useState("home");
  const [child, setChild] = useState(false);
  const [toast, setToast] = useState("");
  const [animation, setAnimation] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<{
    kind: Category;
    generation: string;
    amount?: string;
    reason?: string;
  } | null>(null);
  const [reverse, setReverse] = useState<{
    entry: Entry;
    generation: string;
  } | null>(null);
  useEffect(() => {
    onBusy?.(!!form || !!reverse || dirty);
  }, [onBusy, form, reverse, dirty]);
  useEffect(() => {
    let stopped = false;
    let subscription: { unsubscribe: () => void } | undefined;
    void service
      .initialize()
      .then(() => {
        if (!stopped)
          subscription = liveQuery(() => service.load(false)).subscribe({
            next: (value) => {
              setState(value);
              setError("");
            },
            error: (e) => setError(message(e)),
          });
      })
      .catch((e) => setError(message(e)));
    return () => {
      stopped = true;
      subscription?.unsubscribe();
    };
  }, [service]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const success = (text: string) => {
    setToast(text);
    setForm(null);
    setReverse(null);
  };
  const exportFile = async () => {
    try {
      const b = await service.exportBackup();
      download(b);
      setToast("備份已準備，請確認檔案已保存。");
    } catch (e) {
      setError(message(e));
    }
  };
  if (error)
    return (
      <main className="app">
        <h1>暫時未能載入戶口</h1>
        <p role="alert">{error}</p>
        <p>
          為保護紀錄，已停止寫入。請先匯出保留資料，再用有效備份還原。不要清除網站資料。
        </p>
        <button onClick={() => void exportFile()}>匯出保留資料</button>
        <button onClick={() => location.reload()}>重新載入</button>
        <BackupPanel onDone={() => location.reload()} />
      </main>
    );
  if (!state)
    return (
      <main className="app">
        <h1>印仔小星球</h1>
        <p role="status">正在打開你的星球…</p>
      </main>
    );
  const open = (kind: Category, amount?: string, reason?: string) =>
    setForm({ kind, generation: state.meta.datasetGeneration, amount, reason });
  return (
    <div className="app">
      <header className="topbar">
        <a href="#home" onClick={() => setPage("home")} className="brand">
          <Icon />
          印仔小星球
        </a>
        <button className="quiet" onClick={() => setChild(!child)}>
          {child ? "返回家長模式" : "小朋友展示"}
        </button>
      </header>
      <div hidden={child}>
        <PwaNotice blocked={!!form || !!reverse || dirty || externalBusy} />
      </div>
      <div hidden={child || page !== "home"}>{syncStatus}</div>
      <main inert={externalBusy}>
        {(page === "home" || child) && (
          <>
            <div className="intro">
              <h1>{state.wallet.nickname}的星球</h1>
              <p>每一份努力，都值得一個印仔。</p>
            </div>
            <section className="space-card" aria-label="印仔卡">
              <div className="orbit" aria-hidden="true">
                <svg viewBox="0 0 140 95">
                  <ellipse
                    cx="70"
                    cy="48"
                    rx="59"
                    ry="15"
                    transform="rotate(-25 70 48)"
                    fill="none"
                    stroke="#e6bd76"
                    strokeWidth="5"
                  />
                  <circle cx="70" cy="45" r="29" fill="#a6d6d2" />
                  <path
                    d="M48 30q26 22 47 11M43 46q26 22 47 11"
                    fill="none"
                    stroke="#6fa6ba"
                    strokeWidth="7"
                  />
                </svg>
              </div>
              <p className="card-name">可用印仔</p>
              <div className="balance" data-testid="balance">
                {state.wallet.balance}
                <span>個</span>
              </div>
              <div
                className="stamp-grid"
                key={animation}
                aria-label={`目標進度 ${Math.min(state.wallet.balance, state.settings.goalAmount)} / ${state.settings.goalAmount}`}
              >
                {Array.from(
                  { length: Math.min(state.settings.goalAmount, 20) },
                  (_, i) => (
                    <span
                      key={i}
                      className={`stamp ${i < Math.min(state.wallet.balance, state.settings.goalAmount) ? "filled" : ""}`}
                    >
                      <Icon />
                      {i >= state.wallet.balance && <small>{i + 1}</small>}
                    </span>
                  ),
                )}
              </div>
              {state.settings.goalAmount > 20 && (
                <p>展示前 20 格 · 完整進度見下方</p>
              )}
              <div className="card-footer">
                <span>向着小心願出發</span>
                <svg aria-hidden="true" viewBox="0 0 64 64">
                  <path
                    d="m24 41-6 13 13-6M22 34l-11 1 9-13 10 1M31 45l-1 10 13-9-1-10M22 34C26 17 40 9 53 10c0 13-8 28-23 34Z"
                    fill="#f6f3eb"
                    stroke="#edbb66"
                    strokeWidth="2"
                  />
                  <circle cx="40" cy="24" r="6" fill="#6fa6ba" />
                </svg>
              </div>
            </section>
            <section className="goal">
              <div>
                <h2>{state.settings.goalName}</h2>
                <p>
                  {state.wallet.balance >= state.settings.goalAmount
                    ? "可以兌換！"
                    : `還差 ${state.settings.goalAmount - state.wallet.balance} 個印仔`}
                </p>
              </div>
              <strong>
                {Math.min(state.wallet.balance, state.settings.goalAmount)}
                <span> / {state.settings.goalAmount}</span>
              </strong>
              <progress
                value={Math.min(
                  state.wallet.balance,
                  state.settings.goalAmount,
                )}
                max={state.settings.goalAmount}
              />
              {!child && state.wallet.balance >= state.settings.goalAmount && (
                <button
                  className="quiet"
                  onClick={() =>
                    open(
                      "SPEND",
                      String(state.settings.goalAmount),
                      state.settings.goalName,
                    )
                  }
                >
                  兌換此目標 <Icon name="arrow" />
                </button>
              )}
            </section>
            {!child && (
              <>
                <section className="actions" aria-label="家長操作">
                  <button className="award" onClick={() => open("EARN")}>
                    <Icon />
                    加一個印
                  </button>
                  <button onClick={() => open("DEDUCT")}>
                    <Icon name="minus" />
                    扣一個印
                  </button>
                  <button onClick={() => open("SPEND")}>
                    <Icon name="gift" />
                    消費印仔
                  </button>
                </section>
                {state.wallet.balance === 0 && (
                  <p className="hint">
                    目前沒有可扣的印仔；先記錄下一次小努力吧。
                  </p>
                )}
                <div className="section-heading">
                  <h2>最近紀錄</h2>
                  <button className="quiet" onClick={() => setPage("history")}>
                    查看全部
                  </button>
                </div>
                <History
                  state={state}
                  recent
                  onReverse={(entry) =>
                    setReverse({
                      entry,
                      generation: state.meta.datasetGeneration,
                    })
                  }
                />
              </>
            )}
          </>
        )}
        {
          <>
            <section hidden={child || page !== "history"}>
              <h1>印仔紀錄</h1>
              <div className="statistics">
                <span>
                  累積獲得<strong>{state.stats.EARN}</strong>
                </span>
                <span>
                  累積扣印<strong>{state.stats.DEDUCT}</strong>
                </span>
                <span>
                  淨消費<strong>{state.stats.SPEND}</strong>
                </span>
              </div>
              <History
                state={state}
                onReverse={(entry) =>
                  setReverse({
                    entry,
                    generation: state.meta.datasetGeneration,
                  })
                }
              />
            </section>
            <section hidden={child || page !== "settings"}>
              <h1>星球設定</h1>
              {controls}
              <SettingsPanel
                state={state}
                onDirty={setDirty}
                onDone={setToast}
              />
            </section>
          </>
        }
      </main>
      {!child && (
        <nav className="bottom-nav" aria-label="主選單">
          {[
            ["home", "印仔卡", "star"],
            ["history", "歷史", "history"],
            ["settings", "設定", "settings"],
          ].map(([key, label, icon]) => (
            <button
              key={key}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {form && (
        <TransactionForm
          initial={form}
          state={state}
          onClose={() => setForm(null)}
          onDone={(kind, pending) => {
            if (kind === "EARN" && !pending) setAnimation((n) => n + 1);
            success(
              pending
                ? "加印已暫存，待同步後才加入可用餘額。"
                : "已儲存，印仔紀錄已更新。",
            );
          }}
        />
      )}
      {reverse && (
        <ReverseForm
          entry={reverse.entry}
          generation={reverse.generation}
          onClose={() => setReverse(null)}
          onDone={() => success("已全額撤銷，原紀錄會保留。")}
        />
      )}
      <footer className="app-footer">小小努力，慢慢累積。</footer>
    </div>
  );
}
function TransactionForm({
  initial,
  state,
  onClose,
  onDone,
}: {
  initial: {
    kind: Category;
    generation: string;
    amount?: string;
    reason?: string;
  };
  state: State;
  onClose: () => void;
  onDone: (kind: Category, pending?: boolean) => void;
}) {
  const service = useWallet();
  const [amount, setAmount] = useState(initial.amount || "1");
  const [reason, setReason] = useState(initial.reason || "");
  const [time, setTime] = useState(hkInput());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [frozen, setFrozen] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const kind = initial.kind;
  const options = state.reasons
    .filter(
      (r) =>
        r.category === kind &&
        !r.archived &&
        r.text.toLocaleLowerCase().includes(reason.toLocaleLowerCase()),
    )
    .slice(0, 30);
  const prepare = () => {
    try {
      const value = positiveInteger(amount);
      clean(reason, 100, kind !== "EARN");
      clean(note, 500, false);
      const occurredAt =
        kind === "SPEND" ? hkToUtc(time) : new Date().toISOString();
      if (kind !== "EARN" && value > state.wallet.balance)
        throw Error(
          kind === "DEDUCT"
            ? "目前沒有可扣的印仔"
            : `印仔不足，還差 ${value - state.wallet.balance} 個`,
        );
      setFrozen({
        operationId: crypto.randomUUID(),
        generation: initial.generation,
        kind,
        amount,
        reason,
        note,
        occurredAt,
      });
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };
  const submit = async () => {
    if (lock.current || !frozen) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await service.submit(frozen);
      onDone(kind, "pending" in result);
    } catch (e) {
      setError(`未能儲存：${message(e)}。輸入已保留，可重試。`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        kind === "EARN"
          ? "加一個印"
          : kind === "DEDUCT"
            ? "扣一個印"
            : "消費印仔"
      }
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (frozen) void submit();
          else prepare();
        }}
      >
        <p className="hint">現有 {state.wallet.balance} 個印仔</p>
        <fieldset disabled={busy || !!frozen}>
          {kind === "SPEND" && (
            <label>
              消費數量
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <label>
            {kind === "SPEND"
              ? "消費用途"
              : kind === "DEDUCT"
                ? "扣印原因"
                : "獎勵原因（選填）"}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                kind === "EARN" ? "獎勵印仔" : "選擇下方項目，或輸入新項目"
              }
              autoComplete="off"
            />
          </label>
          {options.length > 0 && (
            <div className="reason-options" aria-label="常用項目">
              {options.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setReason(r.text)}
                >
                  {r.text}
                </button>
              ))}
            </div>
          )}
          <p className="hint">最多 100 字元。新項目只會在成功記錄後保存。</p>
          {kind === "SPEND" && (
            <>
              <label>
                使用日期時間（香港）
                <input
                  type="datetime-local"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
              <label>
                備註（選填，最多 500 字元）
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </>
          )}
        </fieldset>
        {frozen && (
          <div className="confirmation">
            <h3>確認{labels[kind]}</h3>
            <p>
              {frozen.reason || "獎勵印仔"} · {frozen.amount} 個
            </p>
            <p>使用／發生時間：{displayTime(frozen.occurredAt)}</p>
            <p>
              餘額 {state.wallet.balance} →{" "}
              {state.wallet.balance +
                (kind === "EARN" ? 1 : -Number(frozen.amount))}{" "}
              個
            </p>
            <p className="hint">提交時會再核對最新餘額。</p>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="submit"
            disabled={busy || (kind === "DEDUCT" && state.wallet.balance === 0)}
          >
            {busy ? "正在儲存…" : frozen ? "確認儲存" : "下一步：確認"}
          </button>
          {frozen && (
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                setFrozen(null);
                setError("");
              }}
            >
              修改內容
            </button>
          )}
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
        </div>
        {kind === "DEDUCT" && state.wallet.balance === 0 && (
          <p role="status">目前沒有可扣的印仔</p>
        )}
      </form>
    </Modal>
  );
}
function History({
  state,
  recent = false,
  onReverse,
}: {
  state: State;
  recent?: boolean;
  onReverse: (e: Entry) => void;
}) {
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(30);
  const rows = state.entries.filter(
    (e) =>
      (filter === "ALL" || e.kind === filter) &&
      `${e.reasonTextSnapshot} ${e.note}`.includes(search),
  );
  return (
    <>
      {!recent && (
        <>
          <div className="filters" aria-label="紀錄分類">
            {[["ALL", "全部"], ...Object.entries(labels)].map(
              ([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => {
                    setFilter(key);
                    setLimit(30);
                  }}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <label className="search-label">
            搜尋紀錄
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(30);
              }}
              placeholder="原因、用途或備註"
            />
          </label>
        </>
      )}
      {rows.length === 0 ? (
        <div className="empty">
          <Icon />
          <h3>
            {state.entries.length ? "沒有符合的紀錄" : "第一顆星，等你記錄"}
          </h3>
          <p>
            {state.entries.length
              ? "試試其他分類或關鍵字。"
              : "做得好，就加一個印仔。每次記錄都會保留在這裏。"}
          </p>
        </div>
      ) : (
        <ul className="history-list">
          {rows.slice(0, recent ? 3 : limit).map((e) => {
            const original = state.entries.find(
              (o) => o.id === e.reversesEntryId,
            );
            const positive =
              e.kind === "EARN" ||
              (e.kind === "REVERSAL" && original?.kind !== "EARN");
            return (
              <li key={e.id}>
                <div className={`entry-icon ${e.kind.toLowerCase()}`}>
                  <Icon
                    name={
                      e.kind === "SPEND"
                        ? "gift"
                        : e.kind === "DEDUCT"
                          ? "minus"
                          : e.kind === "REVERSAL"
                            ? "history"
                            : "star"
                    }
                  />
                </div>
                <div className="entry-body">
                  <strong>{e.reasonTextSnapshot}</strong>
                  {e.actorName && <p>由{e.actorName}記錄</p>}
                  <p>
                    {e.kind === "REVERSAL" && original?.kind === "SPEND"
                      ? "消費退回"
                      : labels[e.kind]}
                    {state.reversed.has(e.id) ? " · 已撤銷" : ""}
                  </p>
                  <time>{displayTime(e.occurredAt)}</time>
                  <details>
                    <summary>交易詳情</summary>
                    <p>記錄時間：{displayTime(e.createdAt)}</p>
                    <p>實際發生：{displayTime(e.occurredAt)}</p>
                    <p>記錄後餘額：{e.balanceAfter}</p>
                    <p>入帳次序：{e.sequence}</p>
                    {e.note && <p>備註：{e.note}</p>}
                    {original && (
                      <p>
                        更正原紀錄 #{original.sequence}：
                        {original.reasonTextSnapshot}
                      </p>
                    )}
                    {e.kind !== "REVERSAL" && !state.reversed.has(e.id) && (
                      <button className="quiet" onClick={() => onReverse(e)}>
                        撤銷這筆紀錄
                      </button>
                    )}
                  </details>
                </div>
                <strong className="entry-amount">
                  {positive ? "+" : "−"}
                  {e.amount}
                </strong>
              </li>
            );
          })}
        </ul>
      )}
      {!recent && rows.length > limit && (
        <button className="quiet" onClick={() => setLimit((n) => n + 30)}>
          顯示更多紀錄
        </button>
      )}
    </>
  );
}
function ReverseForm({
  entry,
  generation,
  onClose,
  onDone,
}: {
  entry: Entry;
  generation: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const service = useWallet();
  const [reason, setReason] = useState("家長誤操作更正");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const frozen = useRef<{
    generation: string;
    operationId: string;
    reason: string;
  } | null>(null);
  const submit = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      frozen.current ??= {
        generation,
        operationId: crypto.randomUUID(),
        reason: clean(reason),
      };
      const f = frozen.current;
      await service.reverseEntry(
        f.generation,
        f.operationId,
        entry.id,
        f.reason,
      );
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title="全額撤銷紀錄"
      onClose={() => {
        if (!locked.current) onClose();
      }}
    >
      <p>
        {labels[entry.kind]} {entry.amount} 個 · {entry.reasonTextSnapshot}
      </p>
      <p>會新增一筆相反變化的更正，保留原紀錄。不可部分撤銷。</p>
      <label>
        更正原因
        <input
          value={reason}
          disabled={busy || !!frozen.current}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} onClick={() => void submit()}>
        {busy ? "正在儲存…" : "確認全額撤銷"}
      </button>
      <button className="quiet" disabled={busy} onClick={onClose}>
        取消
      </button>
    </Modal>
  );
}
function SettingsPanel({
  state,
  onDirty,
  onDone,
}: {
  state: State;
  onDirty: (v: boolean) => void;
  onDone: (s: string) => void;
}) {
  const service = useWallet();
  const [revision, setRevision] = useState(state.meta.revision);
  const dirtySections = useRef({
    settings: false,
    reasons: false,
    backup: false,
  });
  const mark = (key: keyof typeof dirtySections.current, value: boolean) => {
    dirtySections.current[key] = value;
    onDirty(Object.values(dirtySections.current).some(Boolean));
  };
  const [nickname, setNickname] = useState(state.wallet.nickname);
  const [goalName, setGoalName] = useState(state.settings.goalName);
  const [goalAmount, setGoalAmount] = useState(
    String(state.settings.goalAmount),
  );
  const [generation, setGeneration] = useState(state.meta.datasetGeneration);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    mark("settings", true);
    try {
      await service.saveSettings(
        generation,
        {
          nickname,
          goalName,
          goalAmount: positiveInteger(goalAmount),
        },
        revision,
      );
      setRevision((await service.load()).meta.revision);
      mark("settings", false);
      onDone("設定已儲存");
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <section className="settings-section">
        <h2>小朋友與目標</h2>
        <form
          onChange={() => mark("settings", true)}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <label>
              顯示名稱
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <label>
              目標名稱
              <input
                value={goalName}
                onChange={(e) => setGoalName(e.target.value)}
              />
            </label>
            <label>
              目標印仔數量
              <input
                inputMode="numeric"
                value={goalAmount}
                onChange={(e) => setGoalAmount(e.target.value)}
              />
            </label>
            <p className="hint">目標只顯示進度，達標不會扣印或歸零。</p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy}>儲存設定</button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setNickname(state.wallet.nickname);
                setGoalName(state.settings.goalName);
                setGoalAmount(String(state.settings.goalAmount));
                setGeneration(state.meta.datasetGeneration);
                setRevision(state.meta.revision);
                mark("settings", false);
                setError("");
              }}
            >
              載入目前設定
            </button>
          </fieldset>
        </form>
      </section>
      <ReasonManager
        state={state}
        onDirty={(value) => mark("reasons", value)}
      />
      <BackupPanel
        onDone={() => location.reload()}
        onDirty={(value) => mark("backup", value)}
      />
      <section className="settings-section">
        <h2>安裝到 iPhone</h2>
        <ol>
          <li>用 Safari 開啟網址。</li>
          <li>按「分享」，選「加入主畫面」。</li>
          <li>若有「Open as Web App」，請啟用。</li>
          <li>在主畫面開啟，等候「已可離線使用」。</li>
        </ol>
        <p>
          最好加入主畫面後才開始正式記錄。Safari 分頁與主畫面 App
          的資料不應假設互通。
        </p>
        <h3>你的資料留在這部裝置</h3>
        <p>
          {service.mode === "cloud"
            ? "雲端已確認紀錄由家庭共用；待同步加印仍只在這部裝置。請定期備份，未同步前不要清除網站資料。"
            : "本機模式沒有雲端同步。換電話、清除網站資料或儲存空間不足，都可能失去紀錄。請定期匯出備份，改網址前也要先備份。"}
        </p>
        <p>小朋友展示模式只防誤觸，並非身分驗證。</p>
        <p className="hint">印仔小星球 v1.0.0 · 香港時間 · 本機戶口</p>
      </section>
    </>
  );
}
function ReasonManager({
  state,
  onDirty,
}: {
  state: State;
  onDirty: (v: boolean) => void;
}) {
  const service = useWallet();
  const [revision, setRevision] = useState(state.meta.revision);
  const [category, setCategory] = useState<Category>("EARN");
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<Reason | null>(null);
  const [generation, setGeneration] = useState(state.meta.datasetGeneration);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onDirty(true);
    try {
      await action();
      setText("");
      setEditing(null);
      onDirty(false);
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const rows = state.reasons.filter(
    (r) =>
      r.category === category &&
      r.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <section className="settings-section">
      <h2>原因與用途</h2>
      <label>
        分類
        <select
          value={category}
          disabled={!!text || busy}
          onChange={(e) => setCategory(e.target.value as Category)}
        >
          <option value="EARN">獎勵原因</option>
          <option value="DEDUCT">扣印原因</option>
          <option value="SPEND">消費用途</option>
        </select>
      </label>
      <label>
        搜尋項目
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            editing
              ? service.changeReason(
                  generation,
                  editing.id,
                  {
                    text,
                    archived: editing.archived,
                  },
                  revision,
                )
              : service.addReason(generation, category, text),
          );
        }}
      >
        <fieldset disabled={busy}>
          <label>
            {editing ? "改名" : "新增項目"}
            <input
              value={text}
              onChange={(e) => {
                if (!text) {
                  setGeneration(state.meta.datasetGeneration);
                  setRevision(state.meta.revision);
                }
                setText(e.target.value);
                onDirty(!!e.target.value || !!editing);
              }}
            />
          </label>
          <button disabled={busy}>{editing ? "儲存名稱" : "新增項目"}</button>
          {(editing || text || error) && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setEditing(null);
                setText("");
                setError("");
                onDirty(false);
              }}
            >
              取消編輯
            </button>
          )}
        </fieldset>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="reason-list">
        {rows.map((r) => (
          <li key={r.id}>
            <span>
              {r.text}
              {r.archived ? "（已停用）" : ""}
            </span>
            <button
              className="quiet"
              disabled={busy || !!text}
              onClick={() => {
                setEditing(r);
                setRevision(state.meta.revision);
                setText(r.text);
                setGeneration(state.meta.datasetGeneration);
                onDirty(true);
              }}
            >
              改名
            </button>
            <button
              className="quiet"
              disabled={busy || !!text}
              onClick={() =>
                void run(() =>
                  service.changeReason(state.meta.datasetGeneration, r.id, {
                    text: r.text,
                    archived: !r.archived,
                  }),
                )
              }
            >
              {r.archived ? "啟用" : "停用"}
            </button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="hint">還沒有項目；也可在加印、扣印或消費時直接新增。</p>
      )}
    </section>
  );
}
function download(value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `stamp-wallet-backup-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function BackupPanel({
  onDone,
  onDirty,
}: {
  onDone: () => void;
  onDirty?: (v: boolean) => void;
}) {
  const service = useWallet();
  const cloud = service.mode === "cloud";
  const [preview, setPreview] = useState<Awaited<
    ReturnType<WalletService["previewRestore"]>
  > | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [exported, setExported] = useState<{
    generation: string;
    revision: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const exportNow = async () => {
    try {
      const b = await service.exportBackup();
      download(b);
      setExported({
        generation: b.meta.datasetGeneration,
        revision: b.meta.revision,
      });
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };
  const restore = async () => {
    if (lock.current || !preview) return;
    lock.current = true;
    setBusy(true);
    try {
      if (exported && exported.generation !== preview.expected.generation)
        throw Error("匯出後資料已變更，請重新匯出與預覽");
      await service.restoreBackup(
        preview.backup,
        preview.expected,
        confirmed,
        exported?.revision,
      );
      onDone();
    } catch (e) {
      setError(message(e));
      setConfirmed(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="settings-section">
      <h2>{cloud ? "家庭備份與匯入" : "備份與還原"}</h2>
      {cloud && (
        <p>
          匯出只包含雲端已確認紀錄，待同步加印請另行保存。只有家庭建立者可把完整本機備份匯入空家庭；已有紀錄不能覆蓋。
        </p>
      )}
      <p>定期保存完整 JSON 備份到「檔案」，換電話時便可還原。</p>
      <button disabled={busy} onClick={() => void exportNow()}>
        匯出目前資料
      </button>
      {exported && <p role="status">備份已準備，請確認已保存到「檔案」。</p>}
      <label className="file-label">
        選取 JSON 備份
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setPreview(null);
            setConfirmed(false);
            if (!file) return;
            onDirty?.(true);
            try {
              const p = await service.previewRestore(
                JSON.parse(await file.text()),
              );
              setPreview(p);
              setError("");
              onDirty?.(true);
            } catch (err) {
              setError(message(err));
              onDirty?.(false);
            }
            e.target.value = "";
          }}
        />
      </label>
      {preview && (
        <div className="confirmation">
          <h3>還原預覽</h3>
          <p>
            {preview.backup.wallet.nickname} · {preview.backup.entries.length}{" "}
            筆紀錄 · {preview.backup.wallet.balance} 個印仔
          </p>
          <p>
            {cloud
              ? "這會把本機備份匯入空家庭，兩位家長都會看到。請先保留原始備份。"
              : "這會以備份取代目前所有資料，不會合併。請先按上方「匯出目前資料」保留現有紀錄。"}
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {cloud
              ? "我已保留備份，確認匯入空家庭"
              : "我已保留所需備份，確認取代目前資料"}
          </label>
          <button disabled={!confirmed || busy} onClick={() => void restore()}>
            {busy ? "正在處理…" : cloud ? "確認匯入家庭" : "確認取代並還原"}
          </button>
          <button
            className="quiet"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              onDirty?.(false);
            }}
          >
            取消還原
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
