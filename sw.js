// =============================================
// Service Worker — תזכורת תרופות v3.0
// גישה: בדיקת שעה בכל activation + periodicsync
// setTimeout בתוך SW אינו אמין ב-Android — לא בשימוש
// =============================================

const CACHE_NAME = 'med-reminder-v3';
const MEDS_CACHE = 'meds-data-v1';

// ── התקנה ──────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(['./index.html']).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── הפעלה ──────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== MEDS_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ───────────────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ── הודעות מהאפליקציה ──────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SYNC_MEDS') {
    e.waitUntil(
      storeMeds(e.data.meds).then(() => checkAndFire(e.data.meds))
    );
  }

  if (e.data.type === 'FIRE_NOW') {
    e.waitUntil(fireNotification(e.data.med, true));
  }

  if (e.data.type === 'PING') {
    e.source && e.source.postMessage({ type: 'PONG' });
  }
});

// ── Periodic Background Sync ─────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'med-check') {
    e.waitUntil(checkFromStorage());
  }
});

// ============================================================
// שמירת תרופות ב-CacheStorage (מתמיד גם כשה-SW נסגר)
// ============================================================
async function storeMeds(meds) {
  const cache = await caches.open(MEDS_CACHE);
  await cache.put('./meds-data', new Response(JSON.stringify(meds), {
    headers: { 'Content-Type': 'application/json' }
  }));
}

async function loadMeds() {
  try {
    const cache = await caches.open(MEDS_CACHE);
    const resp = await cache.match('./meds-data');
    return resp ? await resp.json() : [];
  } catch(e) { return []; }
}

async function checkFromStorage() {
  const meds = await loadMeds();
  await checkAndFire(meds);
}

// ============================================================
// בדיקה: האם יש תרופה שצריך לשלוח עכשיו (חלון ±4 דקות)
// ============================================================
async function checkAndFire(meds) {
  if (!meds || !meds.length) return;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayStr = now.toISOString().split('T')[0];

  for (const med of meds) {
    const [h, m] = med.time.split(':').map(Number);
    const medMins = h * 60 + m;
    const diff = Math.abs(medMins - nowMins);

    if (diff <= 4) {
      const key = `fired_${med.id}_${todayStr}`;
      const alreadyFired = await checkAlreadyFired(key);
      if (!alreadyFired) {
        await markFired(key);
        await fireNotification(med, false);
      }
    }
  }
}

// מניעת כפילות — שמירה ב-CacheStorage
async function checkAlreadyFired(key) {
  const cache = await caches.open(MEDS_CACHE);
  return !!(await cache.match('./fired/' + key));
}

async function markFired(key) {
  const cache = await caches.open(MEDS_CACHE);
  await cache.put('./fired/' + key, new Response('1'));
}

// ============================================================
// שליחת ההתרעה
// ============================================================
async function fireNotification(med, isTest) {
  const title = isTest ? '🧪 בדיקת התרעות' : '💊 תזכורת תרופות';
  const body  = isTest
    ? 'ההתרעות פועלות בהצלחה! 🎉'
    : `הגיע הזמן לקחת: ${med.name}`;

  return self.registration.showNotification(title, {
    body,
    icon: buildIcon(),
    badge: buildBadge(),
    tag: isTest ? 'test' : `med-${med.id}-${new Date().toISOString().split('T')[0]}`,
    requireInteraction: !isTest,
    renotify: true,
    dir: 'rtl',
    lang: 'he',
    vibrate: [200, 100, 200, 100, 400],
    actions: isTest ? [] : [
      { action: 'taken', title: '✅ לקחתי' },
      { action: 'snooze', title: '⏰ עוד 10 דקות' }
    ],
    data: { medId: med.id, medName: med.name, medTime: med.time, isTest }
  });
}

// ── לחיצה על ההתרעה ──────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { action } = e;
  const { medId, medName, isTest } = e.notification.data || {};

  if (isTest) {
    e.waitUntil(clients.openWindow('./'));
    return;
  }

  if (action === 'snooze') {
    e.waitUntil(new Promise(resolve => {
      setTimeout(() => {
        self.registration.showNotification('💊 תזכורת (נדחתה)', {
          body: `זכור לקחת: ${medName}`,
          icon: buildIcon(),
          tag: `snooze-${medId}`,
          requireInteraction: true,
          dir: 'rtl',
          vibrate: [300, 100, 300],
          actions: [{ action: 'taken', title: '✅ לקחתי' }],
          data: e.notification.data
        });
        resolve();
      }, 10 * 60 * 1000);
    }));
    return;
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      list.forEach(c => c.postMessage({ type: 'AUTO_TAKEN', medId, action }));
      const win = list.find(c => c.url.includes(self.registration.scope));
      if (win) return win.focus();
      return clients.openWindow('./');
    })
  );
});

// ── SVG Icons ─────────────────────────────────
function buildIcon() {
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" rx="22" fill="#1a2f4e"/>' +
    '<text y="72" x="50" text-anchor="middle" font-size="60">💊</text></svg>'
  );
}

function buildBadge() {
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="12" fill="#4fc3f7"/>' +
    '<text y="17" x="12" text-anchor="middle" font-size="14" fill="#0d1b2a">💊</text></svg>'
  );
}
