# 印仔小星球 — 2026-11-13

## 範圍及假設
一個小朋友、一個本機戶口、一位家長主要使用一部 iPhone；離線單機，沒有自動同步。初始 0、暱稱「小星星」、目標 10／「小小心願」，沒有示範交易，不從相片取姓名或餘額。繁體香港用語、Asia/Hong_Kong；iOS Safari 17+ 與桌面。React、strict TypeScript、Vite、Dexie IndexedDB、vite-plugin-pwa。沒有登入、後端、付款、追蹤、廣告或 AI API。

## 實作次序
A. 骨架、核心測試與資料型別。
B. 原子 ledger、獨立 EARN/DEDUCT/SPEND 原因、撤銷、目標、三頁介面及展示模式。
C. 完整備份驗證、原子還原與 revision/generation 防衝突；PWA 提示更新、根／子路徑、手動 Pages workflow。
D. 單元及瀏覽器測試、獨立 review、文件與 local commits。真機未測明列。

## 帳目契約
sequence 唯一、不可變，歷史作依據，balance 為同步快取。EARN/DEDUCT 固定 1，SPEND 正安全整數。每一步不負數、不溢位。REVERSAL 只指向較早同戶口非更正交易、全額一次。新原因、交易、快取、revision 在同一 transaction。operationId 對固定輸入提供冪等；還原改 generation，所有持久修改增 revision。啟動重播不一致時停止寫入並允許救援匯出。

## 介面與預設決定
直接以原創 SVG/CSS 實作深藍太空印仔卡，奶白頁面及黃色星印；不用照片作背景。首頁餘額與目標優先，家長操作明列加／扣／消費。扣印與消費有確認；展示模式僅防誤觸。原因 100 字元、備註 500；分類獨立、去多餘空白、停用可重用。歷史按 sequence 新至舊分頁，統計按未撤銷金額。可改暱稱、目標，不影響 ledger。日期進階篩選與手動排序非阻擋項目。

## 驗證重點
安全整數與中途負數；跨實例競爭與重試；失敗原子回滾；不可信備份與還原前一刻改動；production SW 與子路徑。自動測試不等於 iPhone 實測。

## 環境紀錄
初始目錄沒有專案檔，.git 為空的唯讀保護目錄；不覆蓋。Node 26.13.0 / npm 11.20.0。Git identity 已有設定。只本機，不建立 remote、不 push、不部署。

## 執行紀錄
- 資料層、輸入、備份及還原測試先建立；首輪缺少服務，實作後 28 項通過。
- 瀏覽器揭示 liveQuery 不允許寫交易；加入會失敗的重現測試，再把初始化移到訂閱前，29 項通過。
- 獨立 reviewer 檢查後修正：開啟撤銷時固定 generation；展示模式保留設定元件；分區 dirty 聚合及寫入鎖；原因草稿存在時禁用其他編輯；PWA onNeedReload 不自動重新載入。以瀏覽器回歸驗證。
- 使用者追加相對路徑要求：Vite 預設 base `./`，Manifest start_url/scope `./`，圖片與 HTML 資源相對引用；同一 build 在根及子目錄測試。
- npm audit 的非破壞性修正沒有可用變更；production dependencies 無警告，開發工具仍有 15 項 low/moderate 間接依賴警告。沒有使用 force 降版。
- 交收驗證：33 項單元／資料測試、root 29 項及 `/stamp-wallet/` 29 項 production E2E 通過；typecheck、lint、build 通過。真機項目見 TEST_REPORT。
- 本機 main：`2cf385e` 資料層與備份；`c1c53a3` 介面、PWA、相對資源、瀏覽器回歸與手動 Pages workflow。交收文件另行提交；無 remote、push 或部署。
