# 驗收報告 — 2026-11-13

## 實測環境與結果

Linux、本機 Node 26.13.0／npm 11.20.0；React 19.3.1、Dexie 4.4.7、Vite 8.3.8、vite-plugin-pwa 2.0.0、Vitest 5.1.0、Playwright 1.65.0。支援開發環境設定為 Node 24 LTS 或 26+，因 lint/test 工具的 engines 交集；Node 24 本輪未另行執行。

| 指令 | 結果 |
|---|---|
| `npm run typecheck` | 已實測：通過 |
| `npm run lint` | 已實測：通過 |
| `npm run test:run` | 已實測：33/33 通過；真實 Dexie + fake-indexeddb |
| `npm run build` | 已實測：通過；dist、Manifest、SW，13 項 precache，約 396 KiB |
| `npm run test:e2e` | 已實測：29/29；production 根路徑 |
| `TEST_BASE=/stamp-wallet/ npm run test:e2e` | 已實測：29/29；同一份相對路徑 production build |
| `npm audit --omit=dev` | 已實測：0 vulnerabilities |
| `npm audit` / `npm audit fix` | 已實測：仍有 15 個開發工具間接依賴警告，2 low / 13 moderate；非破壞性 fix 無變更 |
| `git diff --check` | 已實測：通過 |

瀏覽器組合：Chromium 158（375×812、430×932、1280×900），Playwright WebKit 27.2（390×844）。每組 7 個 E2E，再加 1 個跨視窗新版 SW 測試。根及子路徑共 58 次。瀏覽器與 preview 使用環境正式批准的本機執行權限；最初沙箱無法啟動 preview 的阻塞已解除。

## 需求—測試對照

`U` = tests/unit/wallet.test.ts；`E` = tests/e2e/wallet.spec.ts；`W` = tests/e2e/update.spec.ts。

| # | 驗收要求 | 證據與狀態 |
|---|---|---|
| 1 | 0 → +1 +1 -1 消費1 → 0 | 已實測：U starts empty；E core flows，reload 後仍 0 |
| 2 | 零餘額扣印、不留原因 | 已實測：U zero-balance deduction 檢查 ledger/reasons 均 0；E 中性提示／禁提交 |
| 3 | 12-8=4、淨消費8、拒絕5、可消費4 | 已實測：U 12 - 8，餘額及交易數均核對 |
| 4 | 非法數量／時間 | 已實測：U 0、負數、小數、空白、科學記號、超安全整數、NaN、Infinity；無效日期與 UTC 格式 |
| 5 | operationId 冪等、不同意圖獨立 | 已實測：U idempotent retry；E 寫入失敗保留輸入後重試 |
| 6 | 兩實例／視窗競爭最後1個 | 已實測：U two DB instances；E two real tabs racing，只有一個成功、另一個差1 |
| 7 | 中途失敗原子回滾 | 已實測：U 在 entries creating hook 拋錯，比較完整快照；E 注入一次 QuotaExceededError，保留表單、重試只入帳一次 |
| 8 | 原因改名／停用不改歷史 | 已實測：U snapshot／重新啟用重用；E 原因改名、停用、啟用 |
| 9 | 消費8全額退款、禁止重複及撤銷更正 | 已實測：U full refund；E 消費退回圖示／文字與保留原紀錄 |
| 10 | 花光後不能撤銷加印 | 已實測：U cannot reverse spent award；更正消費後可撤銷 |
| 11 | 補記、時鐘倒退不改 sequence | 已實測：U backdated entries、clock moving backwards；E 補記日期，詳情列兩種時間及「記錄後餘額」 |
| 12 | 達標／換目標／超額不清零 | 已實測：U 27 stamps、target changes；E 目標1兌換一次變0 |
| 13 | 備份來回一致 | 已實測：U 比較 wallet、entries、reasons、settings；E 下載 JSON、預覽、確認還原；統計由同 ledger 重播 |
| 14 | 錯版、重複ID、引用、未來更正、金額、中途負數、損壞 | 已實測：U malformed backups / future reversal / wrong refund / intermediate balance；原資料保留 |
| 15 | 預覽後交易／設定改動、舊世代 | 已實測：U revision、old export revision、restore rollback；E 舊匯出拒絕、舊撤銷表單拒絕。generation E2E 以另一頁 IndexedDB 更新世代並經正常新交易刷新，完整還原另由備份 E2E 覆蓋 |
| 16 | HTML/script 純文字 | 已實測：U 來回文字；E 真實渲染 script 字串，window.hacked 不存在 |
| 17 | production 離線重開與操作 | 已實測：E 等 SW ready、斷網 reload、加、扣、消費、撤銷、原因新增、匯出，再連線 reload 無重複。真機關閉程序／飛行模式未實測 |
| 18 | 更新／migration 不丟資料或表單 | 已實測：W 實際替換 SW 位元、另一頁啟用、兩份草稿及手動更新後 ledger 保留。首次 schema v1 無歷史 schema 可遷移；未來 migration 未實測，不虛構通過 |
| 19 | 根及 Pages 子路徑 | 已實測：相同 dist 在兩個 base，各29項通過；離線預快取資源可取。Manifest/icon 相對路徑已核對 |
| 20 | 手機尺寸、長文字、空／錯誤、focus、safe area | 已實測：375/390/430、桌面截圖、無橫溢、100/101字、dialog Escape、操作與失敗。真實 iPhone 鍵盤／Home Indicator 未實測 |

## 獨立審閱與修正

一位獨立 reviewer，只讀檢查資料層、介面、備份與已安裝 PWA 客戶端程式，實際執行當時 28 項單元測試、typecheck、lint。沒有虛構多人同測，也沒有代理修改檔案。

發現的五項問題已由主實作者修正：撤銷表單開啟時固定 generation；展示模式只隱藏設定而不卸載；設定／原因／備份分區 dirty 與 busy 保護；有原因草稿時禁止其他改名／停用；`onNeedReload` 改為提示，任何視窗更新皆不自動 reload。E 的草稿／舊世代測試和 W 的雙草稿／跨視窗更新驗證修正。另補原因草稿取消入口與無效備份的 dirty 清理。

瀏覽器首輪找到 liveQuery 內不能建立 read-write transaction，已寫重現單元測試先失敗，再把 initialize 移到訂閱前，修正後通過。其後測試選擇器因隱藏設定區的同名文字產生歧義，改成 exact／限定可見頁面；沒有藉改業務預期掩蓋失敗。來源中的模組與資源使用相對路徑，沒有寫死本機絕對路徑。

## 未實測／限制

- **未實測**：真實 iPhone Safari 17、主畫面安裝／冷啟動、iOS 分享／檔案選擇器、真實鍵盤、系統儲存回收及硬體磁碟滿。README 有可逐項執行清單。
- **未實測**：真正 GitHub Pages 發布與組織 Actions 權限；本輪明確不建立 remote、不 push、不部署。workflow 只手動觸發。
- **未實測**：未來 schema migration；本版只有 v1。關閉重開與程式更新保留現有 v1 已測。
- **限制**：啟動／寫入完整重播，歷史分批渲染；沒有對數十萬交易做效能基準。沒有任意備份大小或原因總數上限。
- **已知依賴事項**：audit 警告源於開發鏈的 minimatch/glob/deepmerge 及依賴它們的 lint/workbox packages；沒有 high/critical、正式運行依賴為0。npm 建議 force 降主要版本，不在此輪盲目套用；應跟進上游相容修正。本版不處理不可信專案 build 輸入。
- **可選未做**：日期區間進階篩選、原因手動排序；已有關鍵字搜尋。
- 沒有已知尚未完成的核心帳目功能；以上未測事項仍是正式 iPhone 驗收前的保留項目，不宣稱全平台全面通過。

## 本機版本紀錄

功能版本：main 的 `c1c53a3`（先前資料層 commit `2cf385e`）。交收文件在後續 docs commit；`git log --oneline` 可核對。最終測試使用此功能樹，root 29/29（16.7s），子路徑 29/29（16.8s）；所有 E2E preview server 隨測試結束停止。未留下對外服務。

## GitHub 發布進度（2026-11-13 後續授權）

使用者指定 `https://github.com/hkspurs/yuristampbook` 並授權部署。已保留遠端初始 README commit `7d686b4`，以 merge commit `0735ad1` 整合本機版本並成功 push 到 main，沒有 force push。SSH 登入確認為 hkspurs。

發布前重新執行 typecheck、lint、33 項單元測試及 build，全通過；以實際 `TEST_BASE=/yuristampbook/ npm run test:e2e` 驗證 29/29 通過（16.7s）。程式繼續使用相對資源路徑。

截至本次核對，repository `has_pages: false`，Pages API 為 404，Actions runs 為空；**尚未上線**。此環境只有 Git SSH 登入，沒有 GitHub API token／CLI 或可操作的登入網頁工作階段，因此不能啟用 Pages 或觸發 `workflow_dispatch`。已請使用者在 Settings → Pages 選 GitHub Actions，並在 Pages workflow 按 Run workflow（main）。待完成後核實 workflow 結果及正式 HTTPS PWA。前文「本輪不 push」屬初次本機交收範圍，本節為後續授權的最新狀態。

## V2 家庭同步進度 — 2026-11-13

本機分支 `feature/family-sync`。Node 26.13.0、PostgreSQL 17（獨立 Docker）、Chromium/WebKit。未部署此版本。

| 項目 | 實測結果 |
| --- | --- |
| `npm run typecheck` / `npm run lint` | 已實測：通過 |
| `npm run test:run` | 已實測：43/43；含離線 outbox、不重複入帳、帳戶/家庭隔離、過期 snapshot、固定 bearer 身份檢查 |
| `npm run build` | 已實測：通過；主 JS 592 KB，gzip 約 174 KB，有 >500 KB chunk 提示 |
| `npm run test:e2e` | 已實測：31/31，根路徑；29 原有本機流程 + 2 模擬郵件 API 登入介面測試，沒有寄真實郵件 |
| `bash tests/cloud/run.sh` | 已實測：12/12；真 PostgreSQL，Auth 使用 shim；完整 migration 於單一交易安裝 |
| Supabase 專案連線 | 已實測：`/auth/v1/settings` HTTP 200，email enabled |
| Supabase 帳簿安裝 | 使用者執行 SQL 成功；其後實測 `family_current` 已存在，匿名請求 HTTP 401 / permission denied（符合預期） |
| 真 Supabase Auth / PostgREST / 兩帳戶同步 | 未實測：SQL 已安裝；須先由管理端建立兩個已確認的密碼帳戶，再用兩個帳戶驗收 |
| 離線過期 session 冷啟動及切帳戶 UI 競態 | 已覆核並修正，但未完成專用瀏覽器驗收；資料層與固定 token 有單元測試 |
| V2 子路徑 production | 未重跑；V1 已測，V2 保留相對資源路徑 |
| iPhone 真機、郵件投遞、主畫面雙電話操作 | 未實測 |

獨立 reviewer 指出並已修正：舊 snapshot 覆寫 metadata、已有原因仍允許匯入預覽、RPC 動態 token 身份競態、跨帳戶採納舊結果、離線 INITIAL_SESSION(null) 清除 cache identity。仍需真 Supabase 及兩部 iPhone 驗收，不能以本機測試替代。

公開連線設定保存在忽略提交的 `.env.local`；repository 只包含佔位 `.env.example`。未上傳任何兒童紀錄、未寄實際電郵、資料表其後由使用者在 Supabase SQL Editor 建立。


### 密碼登入取代 OTP — 2026-11-13

使用者確認沒有 SMTP，改用管理者預先建立的兩個已確認帳戶。App 使用 `signInWithPassword`，沒有公開註冊、寄驗證碼或電郵重設入口。密碼只在表單記憶體及 Supabase HTTPS 登入請求使用，成功、登出及切回本機時清空；不自行保存到 IndexedDB/localStorage。

已實測 typecheck、lint、43/43 單元及 build 通過。瀏覽器全套初跑 30/31，唯一失敗為測試替身缺少 Supabase API version header 及其 CORS expose header，令 SDK 不讀取錯誤代碼；補正替身後重跑 cloud-ui 2/2 通過（錯誤密碼保留輸入、成功進入家庭設定、登出、無 OTP/signup 請求、沒有保存密碼）。29 項本機回歸在該全套執行已通過。沒有使用真實帳戶、沒有發信；真雙家長登入同步及 iPhone 驗收仍未完成。此版本未 push／部署。

### 同步控制移到設定 — 2026-11-13

家庭同步入口、成員、邀請碼、立即同步、待同步項目及登出集中於設定頁；首頁只顯示同步摘要。設定區維持掛載，切頁不停止 15 秒同步 timer。typecheck、lint、43/43 unit、build、31/31 production E2E 通過，cloud-ui 驗證首頁不顯示同步入口、設定頁可進入登入。未重做真實雙電話驗收。

### iPhone 意外放大 — 2026-11-13

依使用者要求加入 viewport maximum-scale/user-scalable 限制及 `touch-action: pan-x pan-y`，保留捲動；輸入欄原本繼承標籤 14px，改為明確 16px，避免 iPhone 聚焦小字輸入欄時自動放大。typecheck、lint、build、31/31 production E2E 通過。未實測 iPhone 真機雙指、雙擊及鍵盤聚焦縮放；Safari 可依自身政策忽略 viewport 限制，系統輔助使用縮放不能由網頁停用。參考 https://webkit.org/blog/7367/new-interaction-behaviors-in-ios-10/ 。
