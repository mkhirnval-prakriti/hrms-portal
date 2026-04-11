async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
    lat
  )}&lon=${encodeURIComponent(lng)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "PrakritiHRMS/1.0 (attendance; contact: hr@prakriti.local)",
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { reverseGeocode };
