# 推播通知功能 — 部署說明

這次一共改了/加了 4 個東西：

| 檔案 | 做什麼 |
|---|---|
| `index.html` | App 本身：多了「開啟手機推播通知」的按鈕，會請求權限、把裝置代碼存到雲端 |
| `service-worker.js` | 負責在 App 沒開的時候，把推播顯示成手機的系統通知 |
| `functions/index.js`、`functions/package.json` | **全新的後端程式**：每天早上 8:00（台灣時間）自動檢查每個人的行程/生日，該提醒就發推播 |
| `firestore.rules` | 資料庫安全規則，多開放一個 `fcmTokens` 子集合給登入的使用者自己讀寫 |

沒有下面這幾個步驟，推播不會運作，App 其他功能完全不受影響（開關會顯示「尚未設定」）。

---

## 步驟 1：取得 VAPID 金鑰，貼進 index.html

1. 打開 [Firebase 主控台](https://console.firebase.google.com/) → 選擇 `mystarlifeapp` 專案
2. 左上角齒輪 →「專案設定」→ 上方分頁「Cloud Messaging」
3. 往下找到「Web Push 憑證」區塊，點「產生金鑰組」
4. 複製產生出來那一長串金鑰（格式類似 `BN...一長串英數字`）
5. 打開 `index.html`，搜尋 `YOUR_VAPID_KEY`（總共 1 處），把它換成你剛複製的金鑰：
   ```js
   const FCM_VAPID_KEY = 'BN...你的金鑰...';
   ```

## 步驟 2：更新 Firestore 安全規則

1. Firebase 主控台 → 左側「Firestore Database」→ 上方「規則」分頁
2. 把內容整個換成這次附上的 `firestore.rules` 檔案內容（比原本多了 `fcmTokens` 那一段）
3. 點「發布」

## 步驟 3：安裝部署工具（電腦只需要做一次）

1. 安裝 [Node.js](https://nodejs.org/)（選 LTS 版本即可，跟你電腦目前開發用的應該是同一套）
2. 打開終端機（Windows 是「命令提示字元」或 PowerShell），執行：
   ```
   npm install -g firebase-tools
   firebase login
   ```
   會跳出瀏覽器要你用 Google 帳號登入，選跟 Firebase 專案同一個帳號。

## 步驟 4：把 functions 資料夾放進你的專案

1. 找一個資料夾當作「專案根目錄」（跟 `index.html` 平行、或另外找個地方都可以，`functions` 不需要跟網頁檔案放一起）
2. 把這次附上的 `functions/` 資料夾整個放進這個根目錄
3. 在根目錄新增一個 `firebase.json`，內容如下（如果你之前沒有這個檔案的話）：
   ```json
   {
     "functions": {
       "source": "functions"
     }
   }
   ```
4. 同一個根目錄也建一個 `.firebaserc`：
   ```json
   {
     "projects": {
       "default": "mystarlifeapp"
     }
   }
   ```

## 步驟 5：部署

在專案根目錄（跟 `firebase.json` 同一層）打開終端機，依序執行：
```
cd functions
npm install
cd ..
firebase deploy --only functions
```
第一次部署可能要 1–3 分鐘，跑完會顯示部署成功的網址／函式名稱（`dailyReminderPush`）。

## 步驟 6：把新版 index.html、service-worker.js 上傳回你原本放網頁的地方

覆蓋原本的兩個檔案即可（跟之前一樣的做法）。

## 步驟 7：實際開啟通知

1. 手機或電腦打開 App，先用 Google 帳號登入
2. 進「設定」→ 找到「手機推播通知」→ 點「🔔 開啟這台裝置的推播通知」
3. 瀏覽器會跳出「要允許通知嗎？」，點允許
4. 每台想收到通知的裝置都要各自開一次（手機開一次、電腦開一次，各自獨立）

---

## 關於費用

- Cloud Functions 用的是 Blaze 方案（照用量計費），但有免費額度：每月 200 萬次呼叫、Cloud Scheduler 每個帳號 3 個排程免費。
- 這個排程每天只跑 1 次，就算有幾百個使用者也遠遠用不到免費額度，正常使用下**應該不會產生費用**，但 Google 沒有保證絕對免費，建議之後可以到 Firebase 主控台的「用量與帳單」留意一下。

## 除錯

- 想看排程有沒有正常執行、有沒有報錯：Firebase 主控台 →「Functions」→ 點 `dailyReminderPush` → 「記錄檔」分頁，可以看到每次執行的 log（包含我特別印出的「共 N 位使用者」「使用者 xxx：推播 N 台裝置」等訊息）
- 如果想不等到明天早上 8 點、想馬上測試，可以在主控台的函式列表右側選「立即執行」（測試觸發），或用 `firebase functions:shell` 手動呼叫
