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
