(function (root) {
  const CALENDAR_SUFFIXES = {
    '@m': '@gmail.com',
    '@g': '@group.calendar.google.com',
  };

  function decodeEventId(raw) {
    if (!raw || /^(tasks_|bday_)/.test(raw)) return null;
    let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    let decoded;
    try {
      decoded = atob(b64);
    } catch {
      return null;
    }
    const [eventId, calendarId = ''] = decoded.split(' ');
    if (!eventId) return null;
    const suffix = Object.keys(CALENDAR_SUFFIXES).find((s) => calendarId.endsWith(s));
    return {
      eventId,
      calendarId: suffix ? calendarId.slice(0, -suffix.length) + CALENDAR_SUFFIXES[suffix] : calendarId,
    };
  }

  function compilePatterns(text) {
    const patterns = [];
    const errors = [];
    for (const line of (text || '').split('\n')) {
      const source = line.trim();
      if (!source) continue;
      try {
        patterns.push(new RegExp(source, 'i'));
      } catch (e) {
        errors.push({ source, message: e.message });
      }
    }
    return { patterns, errors };
  }

  function normalizeTitle(title) {
    return (title || '').replace(/\s+/g, '').toLowerCase();
  }

  // chips: [{ eventId, title, scope, pos }] -> groups of indexes (size >= 1)
  function groupDuplicates(chips) {
    const parent = chips.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const firstByKey = new Map();
    const link = (key, i) => {
      if (firstByKey.has(key)) parent[find(i)] = find(firstByKey.get(key));
      else firstByKey.set(key, i);
    };
    chips.forEach((chip, i) => {
      if (chip.eventId) link(`${chip.scope}|id|${chip.eventId}`, i);
      const title = normalizeTitle(chip.title);
      if (title) link(`${chip.scope}|content|${title}|${chip.pos}`, i);
    });
    const groups = new Map();
    chips.forEach((_, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    });
    return [...groups.values()];
  }

  const EPS = 1e-6;
  const overlaps = (a, b) => a.start < b.end - EPS && b.start < a.end - EPS;

  // items: [{ top, bottom }] -> [{ left, width }] in percent
  function layoutLanes(items) {
    const result = items.map(() => ({ left: 0, width: 100 }));
    const order = items
      .map((_, i) => i)
      .sort((a, b) => items[a].top - items[b].top || items[b].bottom - items[a].bottom);

    let cluster = [];
    let clusterBottom = -Infinity;
    const flush = () => {
      const laneEnds = [];
      const laneOf = new Map();
      for (const i of cluster) {
        let lane = laneEnds.findIndex((end) => end <= items[i].top + EPS);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = items[i].bottom;
        laneOf.set(i, lane);
      }
      const lanes = laneEnds.length;
      for (const i of cluster) {
        const lane = laneOf.get(i);
        const span = { start: items[i].top, end: items[i].bottom };
        let width = 1;
        while (
          lane + width < lanes &&
          !cluster.some(
            (j) => laneOf.get(j) === lane + width && overlaps(span, { start: items[j].top, end: items[j].bottom }),
          )
        ) {
          width++;
        }
        result[i] = { left: (lane / lanes) * 100, width: (width / lanes) * 100 };
      }
      cluster = [];
    };
    for (const i of order) {
      if (cluster.length && items[i].top >= clusterBottom - EPS) flush();
      if (!cluster.length) clusterBottom = -Infinity;
      cluster.push(i);
      clusterBottom = Math.max(clusterBottom, items[i].bottom);
    }
    if (cluster.length) flush();
    return result;
  }

  // spans: [{ start, end, row }] -> row index per span, keeping the original vertical order where possible
  function packRows(spans) {
    const order = spans
      .map((_, i) => i)
      .sort((a, b) => (spans[a].row ?? 0) - (spans[b].row ?? 0) || spans[a].start - spans[b].start);
    const rows = [];
    const result = new Array(spans.length);
    for (const i of order) {
      let row = rows.findIndex((placed) => !placed.some((s) => overlaps(s, spans[i])));
      if (row === -1) {
        row = rows.length;
        rows.push([]);
      }
      rows[row].push(spans[i]);
      result[i] = row;
    }
    return result;
  }

  // Early morning always starts at 0:00 and late night always ends at 24:00; the late range never overlaps the early one.
  function foldRanges(earlyEnd, lateStart) {
    const clamp = (h) => Math.min(24, Math.max(0, Math.round(Number(h) || 0)));
    const early = { name: 'early', start: 0, end: clamp(earlyEnd) };
    const late = { name: 'late', start: Math.max(clamp(lateStart), early.end), end: 24 };
    return [early, late].filter((r) => r.end > r.start);
  }

  // ranges: sorted, non-overlapping [{ top, bottom }] in px, each folded down to `band` px
  function foldY(y, ranges, band) {
    let out = y;
    for (const r of ranges) {
      const size = r.bottom - r.top;
      if (y >= r.bottom) out -= size - band;
      else if (y > r.top) out -= (y - r.top) * (1 - band / size);
    }
    return out;
  }

  // Inverse of foldY: a point inside a band maps proportionally back into its range.
  function unfoldY(y, ranges, band) {
    let shift = 0;
    for (const r of ranges) {
      const size = r.bottom - r.top;
      const top = r.top - shift;
      if (y < top) break;
      if (y < top + band) return r.top + ((y - top) * size) / band;
      shift += size - band;
    }
    return y + shift;
  }

  const api = { decodeEventId, compilePatterns, groupDuplicates, layoutLanes, packRows, foldRanges, foldY, unfoldY };
  root.GCalUtilsCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
