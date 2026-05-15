// =============================================
// Service Worker — תזכורת תרופות
// גרסה 2.0
// =============================================

const CACHE_NAME = 'med-reminder-v2';
const ASSETS = ['./index.html'];

// ── התקנה ──────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── הפעלה ──────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch (Cache-first) ─────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ── הודעות מהאפליקציה ──────────────────────
// האפליקציה שולחת: { type: 'SCHEDULE', meds: [...] }
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE') {
    scheduleMeds(e.data.meds);
  }
  if (e.data && e.data.type === 'PING') {
    e.source.postMessage({ type: 'PONG' });
  }
});

// ── לוגיקת תזמון ────────────────────────────
// מחזיק רשימת timers פנימיים בתוך ה-SW
let _timers = [];

function clearTimers() {
  _timers.forEach(t => clearTimeout(t));
  _timers = [];
}

function scheduleMeds(meds) {
  clearTimers();
  if (!meds || !meds.length) return;

  const now = Date.now();

  meds.forEach(med => {
    const [h, min] = med.time.split(':').map(Number);
    const target = new Date();
    target.setHours(h, min, 0, 0);

    let diff = target.getTime() - now;
    if (diff <= 0) diff += 24 * 60 * 60 * 1000; // מחר

    // לא מתזמנים יותר מ-24 שעות קדימה
    if (diff <= 24 * 60 * 60 * 1000) {
      const t = setTimeout(() => {
        fireNotification(med);
        // תזמון מחדש למחר אחרי שניה
        setTimeout(() => scheduleMeds(meds), 1500);
      }, diff);
      _timers.push(t);
    }
  });
}

function fireNotification(med) {
  const options = {
    body: `הגיע הזמן לקחת: ${med.name}`,
    icon: buildIcon(),
    badge: buildBadge(),
    tag: `med-${med.id}`,
    requireInteraction: true,
    renotify: true,
    dir: 'rtl',
    lang: 'he',
    vibrate: [200, 100, 200, 100, 400],
    actions: [
      { action: 'taken', title: '✅ לקחתי' },
      { action: 'snooze', title: '⏰ תזכר עוד 10 דקות' }
    ],
    data: { medId: med.id, medName: med.name, medTime: med.time }
  };

  self.registration.showNotification('💊 תזכורת תרופות', options);
}

// ── לחיצה על ההתרעה ──────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const { action, notification } = e;
  const { medId, medName, medTime } = notification.data || {};

  if (action === 'snooze') {
    // דחיית 10 דקות
    setTimeout(() => {
      self.registration.showNotification('💊 תזכורת (נדחתה)', {
        body: `זכור לקחת: ${medName}`,
        icon: buildIcon(),
        tag: `snooze-${medId}`,
        requireInteraction: true,
        dir: 'rtl',
        vibrate: [300, 100, 300],
        data: { medId, medName, medTime }
      });
    }, 10 * 60 * 1000);
    return;
  }

  // פתיחת האפליקציה
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // שלח הודעה לאפליקציה לסמן "נלקח"
      for (const client of list) {
        client.postMessage({ type: 'AUTO_TAKEN', medId, action });
        if (list.length > 0) {
          client.focus();
          return;
        }
      }
      // אם האפליקציה סגורה — פתח אותה
      clients.openWindow('./');
    })
  );
});

// ── כיבוי התרעה ──────────────────────────────
self.addEventListener('notificationclose', () => {});

// ── Helper: SVG icons ─────────────────────────
function buildIcon() {
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" rx="22" fill="#1a2f4e"/>' +
    '<text y="72" x="50" text-anchor="middle" font-size="60">💊</text>' +
    '</svg>'
  );
}

function buildBadge() {
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="12" fill="#4fc3f7"/>' +
    '<text y="17" x="12" text-anchor="middle" font-size="14" fill="#0d1b2a">+</text>' +
    '</svg>'
  );
}
