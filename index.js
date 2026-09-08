/* 推し手帳 - 每日提醒推播排程
   每天早上 8:00（台灣時間）自動執行一次：
   1. 找出所有使用者
   2. 讀取每個人的行程（oshi-schedule）與藝人生日（oshi-artists）
   3. 判斷今天／明天有沒有行程、開賣、生日
   4. 有的話，推播到這個使用者已註冊的所有裝置

   部署方式請見同資料夾的 DEPLOY_README.md
*/
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

/* 算出台灣時間（UTC+8）今天/明天的日期字串 'YYYY-MM-DD'，
   不依賴伺服器所在時區，確保不管 Cloud Functions 實際跑在哪個時區都準確 */
function taipeiDateStr(offsetDays) {
  const ms = Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/* 邏輯對應 App 內 index.html 的 computeTodayReminderItems()，兩邊要保持一致 */
function computeReminderItems(schedule, artists, today, tomorrow) {
  const items = [];

  (schedule || []).forEach((s) => {
    if (!s || !s.date) return;
    const start = s.date;
    const end = s.isMultiDay && s.endDate ? s.endDate : s.date;
    const isTodayEvent = today >= start && today <= end;
    const isTomorrowEvent = !isTodayEvent && tomorrow >= start && tomorrow <= end;
    if (isTodayEvent) {
      items.push({ icon: '🎤', when: 'today', text: `今天是「${s.title}」的日子` });
    } else if (isTomorrowEvent) {
      items.push({ icon: '🎤', when: 'tomorrow', text: `明天是「${s.title}」的日子` });
    }
    if (s.onSaleDate === today) {
      items.push({ icon: '🎫', when: 'today', text: `「${s.title}」今天開賣！` });
    } else if (s.onSaleDate === tomorrow) {
      items.push({ icon: '🎫', when: 'tomorrow', text: `「${s.title}」明天開賣，記得設鬧鐘` });
    }
  });

  (artists || []).forEach((a) => {
    if (!a || !a.birthday || a.birthday.length < 10) return;
    if (a.birthday.slice(5, 10) === today.slice(5, 10)) {
      items.push({ icon: '🎂', when: 'today', text: `今天是 ${a.name} 的生日！` });
    }
  });

  items.sort((a, b) => (a.when === 'today' ? 0 : 1) - (b.when === 'today' ? 0 : 1));
  return items;
}

function buildNotificationPayload(items) {
  const lines = items.map((it) => `${it.icon} ${it.text}`);
  const MAX_LINES = 3;
  const body =
    lines.slice(0, MAX_LINES).join('\n') +
    (lines.length > MAX_LINES ? `\n...還有 ${lines.length - MAX_LINES} 則，打開 App 查看` : '');
  return { title: '☀️ 今日提醒 - 推し手帳', body };
}

exports.dailyReminderPush = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'Asia/Taipei', region: 'asia-east1' },
  async () => {
    const today = taipeiDateStr(0);
    const tomorrow = taipeiDateStr(1);

    // listDocuments() 才能列出「只有子集合、本身沒有實際文件內容」的 users/{uid}
    const userRefs = await db.collection('users').listDocuments();
    console.log(`共 ${userRefs.length} 位使用者，開始檢查提醒`);

    for (const userRef of userRefs) {
      try {
        const [scheduleDoc, artistsDoc] = await Promise.all([
          userRef.collection('data').doc('oshi-schedule').get(),
          userRef.collection('data').doc('oshi-artists').get(),
        ]);
        const schedule = (scheduleDoc.exists && scheduleDoc.data().value) || [];
        const artists = (artistsDoc.exists && artistsDoc.data().value) || [];

        const items = computeReminderItems(schedule, artists, today, tomorrow);
        if (items.length === 0) continue;

        const tokensSnap = await userRef.collection('fcmTokens').get();
        if (tokensSnap.empty) continue;
        const tokens = tokensSnap.docs.map((d) => d.id);

        const payload = buildNotificationPayload(items);
        const res = await messaging.sendEachForMulticast({
          notification: { title: payload.title, body: payload.body },
          data: { url: './' },
          tokens,
        });

        // 清掉已經失效（使用者解除授權、App 移除等）的裝置權杖，避免下次繼續浪費配額
        const invalidTokens = [];
        res.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error && r.error.code;
            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              invalidTokens.push(tokens[idx]);
            }
          }
        });
        await Promise.all(invalidTokens.map((t) => userRef.collection('fcmTokens').doc(t).delete()));

        console.log(`使用者 ${userRef.id}：推播 ${tokens.length} 台裝置，成功 ${res.successCount} 台`);
      } catch (e) {
        console.error(`使用者 ${userRef.id} 的提醒處理失敗`, e);
      }
    }
  }
);
