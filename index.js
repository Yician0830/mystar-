/* 推し手帳 - 每日提醒推播 Cloud Function
   每天固定時間跑一次，檢查每個使用者「明天」有沒有：
     - 行程（oshi-schedule 裡 date 是明天）
     - 開賣日（oshi-schedule 裡 onSaleDate 是明天）
     - 生日（oshi-artists 裡 birthday 的「月-日」跟明天相同，年份不管）
   有的話，就對這個使用者所有已註冊的裝置（fcmTokens）發送一則推播。

   資料結構（跟 index.html 的 saveKey/loadKey 對齊）：
     users/{uid}/data/oshi-schedule   -> { value: [ {title, date, onSaleDate, location, ...}, ... ] }
     users/{uid}/data/oshi-artists    -> { value: [ {name, birthday, ...}, ... ] }
     users/{uid}/fcmTokens/{token}    -> { token, createdAt, userAgent }
*/
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {getMessaging} = require('firebase-admin/messaging');
const {logger} = require('firebase-functions');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

/* 使用者主要是台灣人，用台北時區判斷「今天/明天」比較符合直覺，
   不然 Cloud Function 預設用 UTC 算日期，半夜前後會差一天。 */
const TIMEZONE = 'Asia/Taipei';

function toDateStr(date){
  // 回傳 TIMEZONE 當地時間的 yyyy-mm-dd
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit'
  }).format(date);
}
function toMonthDay(dateStr){
  // 從 yyyy-mm-dd 取出 MM-DD，用來比對生日（忽略年份）
  if(!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/* 每天早上 9 點（台北時間）執行一次。要改時間的話改這個 cron 字串就好，
   例如 '0 8 * * *' 就是早上 8 點。 */
exports.dailyReminderPush = onSchedule(
  { schedule: '0 9 * * *', timeZone: TIMEZONE, region: 'asia-east1' },
  async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const targetDateStr = toDateStr(tomorrow);   // 例：2026-09-11
    const targetMonthDay = targetDateStr.slice(5); // 例：09-11

    const usersSnap = await db.collection('users').get();
    logger.info(`開始檢查 ${usersSnap.size} 位使用者，目標日期 ${targetDateStr}`);

    let sentCount = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      try {
        const [scheduleDoc, artistsDoc, tokensSnap] = await Promise.all([
          db.collection('users').doc(uid).collection('data').doc('oshi-schedule').get(),
          db.collection('users').doc(uid).collection('data').doc('oshi-artists').get(),
          db.collection('users').doc(uid).collection('fcmTokens').get()
        ]);

        if (tokensSnap.empty) continue; // 這個使用者沒開推播，跳過

        const scheduleList = (scheduleDoc.exists && Array.isArray(scheduleDoc.data().value)) ? scheduleDoc.data().value : [];
        const artistList = (artistsDoc.exists && Array.isArray(artistsDoc.data().value)) ? artistsDoc.data().value : [];

        const lines = [];
        scheduleList.forEach(item => {
          if (!item) return;
          if (item.date === targetDateStr) {
            lines.push(`📅 明天有行程：${item.title || '未命名行程'}${item.location ? '＠' + item.location : ''}`);
          }
          if (item.onSaleDate === targetDateStr) {
            lines.push(`🎟️ 明天開賣：${item.title || '未命名行程'}`);
          }
        });
        artistList.forEach(artist => {
          if (!artist) return;
          const md = toMonthDay(artist.birthday);
          if (md && md === targetMonthDay) {
            lines.push(`🎂 明天是 ${artist.name || '藝人'} 的生日！`);
          }
        });

        if (lines.length === 0) continue;

        const title = lines.length === 1 ? '☀️ 推し手帳 明日提醒' : `☀️ 推し手帳 明日有 ${lines.length} 件提醒`;
        const body = lines.join('\n');
        const tokens = tokensSnap.docs.map(d => d.id);

        const resp = await messaging.sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: { url: './' }
        });
        sentCount += resp.successCount;

        // 把失效（解除安裝、清除資料等原因）的裝置代碼清掉，避免下次還一直嘗試發送
        const invalidTokens = [];
        resp.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error && r.error.code;
            if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
              invalidTokens.push(tokens[idx]);
            }
          }
        });
        if (invalidTokens.length) {
          await Promise.all(
            invalidTokens.map(t => db.collection('users').doc(uid).collection('fcmTokens').doc(t).delete().catch(() => {}))
          );
        }
      } catch (e) {
        logger.error(`使用者 ${uid} 的提醒處理失敗`, e);
      }
    }

    logger.info(`本次共發送 ${sentCount} 則推播`);
    return null;
  }
);
