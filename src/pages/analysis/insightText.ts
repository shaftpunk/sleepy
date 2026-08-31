import { minutesToClockLabel, two } from "../../analytics/time";
import { formatDuration } from "../../lib/format";
import type { Insight } from "../../analytics/types";

function weekdayName(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const name = new Intl.DateTimeFormat("nb-NO", { weekday: "long" }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function insightText(insight: Insight): string {
  const p = insight.payload;

  switch (insight.id) {
    case "busiest-window": {
      const start = Number(p.bucketIndex) * 3;
      const end = start + 3;
      return `⏰ Mest søvn skjer mellom kl. ${two(start)} og ${two(end)}.`;
    }

    case "typical-rhythm": {
      const bedtime = minutesToClockLabel(Number(p.bedtimeMin));
      const wake = minutesToClockLabel(Number(p.wakeMin));
      return `🌙 Legger seg vanligvis rundt kl. ${bedtime} og våkner rundt kl. ${wake}.`;
    }

    case "bedtime-consistency": {
      const stddev = Math.round(Number(p.stddevMinutes));
      const clause =
        p.label === "svært stabil"
          ? "Leggetiden er svært stabil"
          : p.label === "varierer noe"
            ? "Leggetiden varierer noe"
            : "Leggetiden varierer mye";
      const emoji = p.label === "svært stabil" ? "✅" : p.label === "varierer noe" ? "〰️" : "⚠️";
      return `${emoji} ${clause} (±${stddev} min).`;
    }

    case "best-day-last-7": {
      return `⭐ ${weekdayName(String(p.dayKey))} var beste dagen med ${formatDuration(Number(p.totalMinutes))} søvn.`;
    }

    case "night-share": {
      const pct = Math.round(Number(p.atNightPct));
      if (p.tier === "high") {
        return `🌟 ${pct}% av søvnen er om natten – en fin, satt rytme.`;
      }
      if (p.tier === "mid") {
        return `🌙 ${pct}% av søvnen er om natten, resten fordelt på dagsøvner.`;
      }
      return `☀️ Mesteparten av søvnen skjer fortsatt på dagtid (${100 - pct}%).`;
    }

    case "avg-duration-comparison": {
      return `📏 Nattsøvn varer i snitt ${formatDuration(Number(p.nightAvgMin))}, dagsøvn ${formatDuration(Number(p.napAvgMin))}.`;
    }

    case "quality-average": {
      const avg = Number(p.avgRating).toFixed(1);
      const descriptor =
        p.tier === "high" ? "stort sett rolige" : p.tier === "mid" ? "ganske rolige" : "litt urolige";
      return `❤️ Snittkvalitet er ${avg}/5 – søvnene er ${descriptor}.`;
    }

    case "quality-trend": {
      return p.direction === "up"
        ? "📈 Søvnkvaliteten har blitt bedre den siste tiden."
        : "📉 Søvnkvaliteten har gått litt ned den siste tiden.";
    }

    case "nap-consistency": {
      const min = Number(p.minCount);
      const max = Number(p.maxCount);
      return Number(p.spread) <= 1
        ? `✔ Antall søvner per dag er jevnt (${min}–${max}).`
        : `〰️ Antall søvner varierer fra ${min} til ${max} per dag.`;
    }

    case "median-wake-window": {
      return `👀 Typisk våkenvindu er ${formatDuration(Number(p.medianMinutes))}.`;
    }

    case "wake-window-trend": {
      if (p.direction === "lengthening") {
        return `📈 Våkenvinduene blir lengre utover dagen (${formatDuration(Number(p.earlyMedian))} → ${formatDuration(Number(p.lateMedian))}).`;
      }
      if (p.direction === "shortening") {
        return "📉 Våkenvinduene blir kortere utover dagen.";
      }
      return "✔ Våkenvinduene er jevne gjennom dagen.";
    }

    case "missing-data": {
      return `ℹ️ ${p.count} lange opphold er holdt utenfor – trolig uregistrerte søvner.`;
    }

    case "long-sleep-milestone": {
      return `🏆 Lengste sammenhengende søvn var ${formatDuration(Number(p.minutes))}.`;
    }

    case "daily-share": {
      return `🕑 Babyen sover omtrent ${Math.round(Number(p.pct))}% av døgnet.`;
    }

    case "fallback-no-data":
    default: {
      return "ℹ️ Registrer noen flere søvner for å låse opp innsikt.";
    }
  }
}
