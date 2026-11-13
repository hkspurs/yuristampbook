# 印仔小星球 / Stamp Wallet

給家長與小朋友的單機印仔戶口。可加印、扣印、消費及全額撤銷；餘額永不小於 0，達標不會歸零。所有正式紀錄存在目前瀏覽器的 IndexedDB，沒有登入、雲端同步、GitHub API、追蹤或付款。

## 本機啟動

需要 Node.js **24 LTS 或 26+**（建議 `.nvmrc` 的 24）；npm 與 lockfile 一起使用。本次實測 Node 26.13.0。

在專案根目錄執行：

```sh
npm ci
npm run dev
```

同一電腦開 `http://localhost:5173/`。開發伺服器並非 PWA 離線驗收環境。

```sh
npm run typecheck
npm run lint
npm run test:run
npm run build
npm run preview -- --port 4173
```

Production 預覽：同一電腦開 `http://localhost:4173/`。build 產生 `dist/`，部署只需要這些靜態檔案，不需要 Node.js 伺服器。其他裝置須使用執行主機的實際網絡地址；`localhost` 指該裝置自己。

程式使用相對路徑，Vite 預設 `base: './'`，沒有寫死帳戶、repo 名稱或本機磁碟路徑。同一份 `dist` 可放到根目錄或 `/stamp-wallet/`。子目錄必須以 `/` 結尾，頁面切換不依賴伺服器 rewrite。若確有固定 URL 需要，可用 `VITE_BASE=/your-repo/ npm run build` 覆寫；預設相對路徑已適合 Pages。

## 日常使用

- 初始「小星星」、0 個印、10 個「小小心願」。設定可改名及目標。
- 「加一個印」可選原因，確認保存後 +1；「扣一個印」須填原因，確認前後餘額後 -1。
- 「消費印仔」填正整數數量、用途及香港時間，可補記過往，備註選填。餘額不足會保留輸入，不縮減數量。
- 新原因成功入帳時保存。三類清單獨立；設定可新增、改名、停用及啟用。歷史保留當時文字。
- 歷史按入帳次序顯示，30 筆分批，支援分類／關鍵字搜尋。展開「交易詳情」可全額撤銷；原交易保留，更正不能再撤銷。
- 印仔已花掉時不能撤銷造成負數的加印；先更正相關消費／扣減。
- 目標只反映可用餘額，超出部分保留；「兌換此目標」仍須完成同一個消費確認流程。
- 小朋友展示模式隱藏家長控制；「返回家長模式」返回。只是防誤觸，不是登入或身分驗證。

## 備份與還原

設定 →「匯出目前資料」，把 JSON 保存到「檔案」或其他可靠位置。包含完整歷史、原因、設定及必要 metadata，不只是餘額。請定期備份；下載提示不等於已保存成功，請檢查檔案。

還原只提供**取代**：選取 JSON → 完整驗證 → 查看暱稱／筆數／餘額 → 先匯出目前資料 → 勾選已保留備份 → 確認取代。任一驗證或儲存失敗保留原資料。預覽後另一視窗改動交易、原因或設定時會拒絕，須重新預覽、匯出及確認。匯出 revision 和預覽 revision 必須相同。還原成功重新載入；其他舊視窗表單會被拒絕，請重新開啟。

若啟動發現帳目不一致，程式會停止不安全寫入，提供救援匯出與還原；不要先清除網站資料。救援匯出保留原始內容，不保證損壞內容可直接還原，應使用較早有效備份。

Safari 分頁與主畫面 Web App 的資料不應假設互通。最好加入主畫面後才開始正式記錄。本機資料不是雲端備份；換電話、清除網站資料、私密瀏覽或系統回收空間可能失去紀錄。換 origin／網址前先匯出，到新網址後還原。

## iPhone 安裝及離線

1. Safari 開 HTTPS 網址。
2. 分享 → 加入主畫面。
3. 若有「Open as Web App」，請啟用。
4. 從主畫面開啟，連線等候「已可離線使用」，才開始離線使用。

圖示、HTML、JS、CSS 都由 Service Worker 預快取，沒有外部字體/CDN。離線可加扣、消費、撤銷、管理原因及備份。更新提示「有新版本，重新開啟更新」，可稍後處理；有表單／草稿時不接受更新，其他視窗更新也不會強制 reload。新版 worker 啟用後再按「立即更新」重新開啟。更新程式快取不會刪除 IndexedDB。

電腦 `localhost` 是 Service Worker 安全環境例外，iPhone 開 `http://區域網IP` **不是**。真機可使用已由裝置信任的本機 HTTPS reverse proxy（憑證 SAN 對應主機名）連到 preview，或日後正式 Pages HTTPS；自行按組織程序配置憑證，本程式不安裝憑證、不修改信任、不建立公開 tunnel。

### 真實 iPhone 驗收清單（本輪未實測）

- [ ] iOS 17+ Safari 連線開啟、加入主畫面與 icon。
- [ ] 主畫面冷啟動，確認與 Safari 的資料分區行為。
- [ ] 顯示離線準備完成後，飛行模式、關閉 App、重開，再加／扣／消費／撤銷。
- [ ] 回復網絡，餘額及交易筆數沒有重複。
- [ ] 匯出至「檔案」，經分享／檔案選擇器匯入，預覽後還原。
- [ ] 中文輸入法、數字與日期鍵盤、橫直向及 Home Indicator 不遮住提交；表單可捲動。
- [ ] 更新提示、稍後、填表中另一視窗更新、手動重開後資料保留。

Playwright WebKit 與手機 viewport 並不等於以上真機測試，也不等於 Safari 17 執行引擎測試。

## 自動驗證

```sh
npx playwright install chromium webkit
npm run build
npm run test:e2e
TEST_BASE=/stamp-wallet/ npm run test:e2e
```

Linux 若缺系統瀏覽器依賴，按 Playwright 官方安裝說明處理；不要把工具失敗當測試通過。E2E 啟動 production preview，包含 375／390／430px、Chromium／WebKit、完整操作、離線重開、儲存失敗重試、草稿、備份、generation 及更新。更新測試暫改 `dist/sw.js` 模擬新版，finally 恢復；不改來源或帳目 schema。測試輸出在 `test-results/`，未提交。

資料 schema v1 為首次版本，沒有虛構舊版 migration。未來增加欄位時須在 Dexie 明確新增 `.version(n).stores(...).upgrade(...)`，更新備份版本 validator 並保留舊版遷移測試；不可刪資料庫重建。現有 v1 關閉重開及 SW 更新保留資料已由自動測試覆蓋。資料層啟動和寫入前做完整重播，歷史只分批渲染；非常大量交易仍需未來效能量測。

## GitHub Pages：日後手動發布

本輪沒有 remote、push 或公開部署。`.github/workflows/pages.yml` **只**接受 `workflow_dispatch`，不在 push／PR 自動部署。

日後由你建立 GitHub repository，確認要公開的原始碼後：

```sh
git remote add origin <你建立的 repository Git URL>
git push -u origin main
```

1. GitHub Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
2. workflow 必須存在 default branch。Actions → **Publish Stamp Wallet manually** → **Run workflow**。
3. workflow 使用 `contents: read`、`pages: write`、`id-token: write`；若組織限制 Actions 或 `github-pages` environment，按組織規則批准。
4. 成功後從 workflow／Pages 顯示的實際 HTTPS URL 開啟。這裏不提供虛構已部署網址。

`dist/` 不含真實兒童資料；日常紀錄只寫 IndexedDB，不做 commit。不要把匯出的個人 JSON 放進 repository。`.gitignore` 排除依賴、build、測試輸出、憑證及備份檔。

## 官方配置依據

2026-11-13 核對：[React/Vite](https://react.dev/learn/build-a-react-app-from-scratch)、[Vite Pages/base](https://vite.dev/guide/static-deploy)、[Dexie 原子 transaction](https://dexie.org/docs/Dexie/Dexie.transaction())、[PWA 更新提示](https://vite-pwa-org.netlify.app/guide/prompt-for-update)、[Apple 安裝](https://support.apple.com/guide/iphone/iphea86e5236/ios)、[WebKit 儲存政策](https://webkit.org/blog/14403/updates-to-storage-policy/)、[Safari 17.2 Web Apps](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)、[GitHub 手動 workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[Vitest](https://vitest.dev/guide/)、[Playwright browsers](https://playwright.dev/docs/browsers)、[Service Worker 安全環境與 scope](https://www.w3.org/TR/service-workers/)。實際套件版本見 lockfile。
