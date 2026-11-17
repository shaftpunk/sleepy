/* Seeded synthetic sleep histories for forecast tests and backtesting.
   Entirely artificial: no real user, baby or household data is used. Local
   times are built with the process timezone (tests set TZ=Europe/Oslo), so the
   35-day window ending mid-November spans the October DST change. */
const MINUTE = 60000;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (r, mean, sd) => mean + sd * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const session = (startMs, endMs) => ({ id: `${startMs}`, startMs, endMs, durationMin: (endMs - startMs) / MINUTE, rate: null, note: null, sleepTypeRaw: 'sleep' });

/* Profiles. Each day starts from a morning wake; naps follow wake windows
   until the next onset would pass the evening cutoff, then bedtime. */
const PROFILES = {
  // Wake window after a nap depends on that nap's length (short -> shorter).
  conditional: { ageDays: 180, wake: [390, 25], firstWindow: [120, 12], cutoff: 17 * 60 + 15, missing: 0.04,
    nap: r => r() < 0.4 ? normal(r, 35, 5) : normal(r, 90, 10),
    windowAfter: (r, nap) => nap < 60 ? normal(r, 100, 10) : normal(r, 155, 12), bedtimeWindow: [150, 15] },
  // Moving from 3 to 2 naps: long windows, variable naps.
  transition: { ageDays: 270, wake: [400, 25], firstWindow: [165, 20], cutoff: 16 * 60 + 30, missing: 0.04,
    nap: r => normal(r, 75, 25), windowAfter: (r, nap) => normal(r, 190 + (nap - 75) * 0.4, 25), bedtimeWindow: [200, 20] },
  // Newborn: short irregular sleeps around the clock, fragmented nights.
  newborn: { ageDays: 42, wake: [420, 60], firstWindow: [60, 20], cutoff: 19 * 60, missing: 0.08,
    nap: r => Math.max(15, normal(r, 70, 40)), windowAfter: r => Math.max(25, normal(r, 70, 25)), bedtimeWindow: [70, 20], fragmentedNight: true },
};

function generate(profileName, { endDate = new Date(2026, 10, 16), days = 35, seed = 7 } = {}) {
  const p = PROFILES[profileName], r = rng(seed), sessions = [], dayPlans = [];
  let previousBedtime = null;
  for (let d = days; d >= 0; d--) {
    const date = new Date(endDate); date.setDate(date.getDate() - d); date.setHours(0, 0, 0, 0);
    const wakeAt = new Date(date); wakeAt.setHours(0, Math.round(normal(r, ...p.wake)), 0, 0);
    if (previousBedtime !== null) {
      if (p.fragmentedNight) { // night in pieces separated by short feeds
        let t = previousBedtime;
        while (t < wakeAt.getTime() - 40 * MINUTE) { const end = Math.min(wakeAt.getTime(), t + Math.max(60, normal(r, 160, 40)) * MINUTE); sessions.push(session(t, end)); t = end + Math.max(10, normal(r, 15, 4)) * MINUTE; }
      } else sessions.push(session(previousBedtime, wakeAt.getTime()));
    }
    const naps = [];
    let awakeSince = wakeAt.getTime(), window = normal(r, ...p.firstWindow);
    for (;;) {
      const onset = awakeSince + window * MINUTE;
      const clock = new Date(onset).getHours() * 60 + new Date(onset).getMinutes();
      if (clock > p.cutoff || naps.length >= 6) break;
      const duration = Math.max(15, p.nap(r));
      naps.push({ startMs: onset, endMs: onset + duration * MINUTE });
      awakeSince = onset + duration * MINUTE; window = p.windowAfter(r, duration);
    }
    for (const nap of naps) if (r() > p.missing) sessions.push(session(nap.startMs, nap.endMs));
    previousBedtime = awakeSince + normal(r, ...p.bedtimeWindow) * MINUTE;
    dayPlans.push({ date: date.getTime(), wakeAt: wakeAt.getTime(), naps, bedtime: previousBedtime });
  }
  return { profile: p, sessions: sessions.sort((a, b) => a.startMs - b.startMs), dayPlans };
}

module.exports = { generate, session, PROFILES, MINUTE };
