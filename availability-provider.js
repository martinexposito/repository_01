const TOMTOM_EV_SEARCH_URL = 'https://api.tomtom.com/search/2/evsearch';

export function getProviderDiagnostics() {
  return {
    tomtom: {
      configured: Boolean(process.env.TOMTOM_API_KEY),
      keyLength: process.env.TOMTOM_API_KEY ? process.env.TOMTOM_API_KEY.length : 0
    },
    electromaps: {
      configured: Boolean(process.env.ELECTROMAPS_USERNAME && process.env.ELECTROMAPS_PASSWORD)
    },
    reve: {
      configured: Boolean(process.env.REVE_API_URL)
    },
    ocpi: {
      configured: Boolean(process.env.OCPI_BASE_URL && process.env.OCPI_TOKEN)
    }
  };
}

export async function getAvailability({ center, radiusKm, stations }) {
  const providerResults = await Promise.allSettled([
    getTomTomAvailability({ center, radiusKm, stations }),
    getElectromapsAvailability({ stations }),
    getReveAvailability({ stations }),
    getOcpiAvailability({ stations })
  ]);

  return providerResults
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
}

async function getTomTomAvailability({ center, radiusKm, stations }) {
  if (!process.env.TOMTOM_API_KEY) return [];
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return [];
  if (!Array.isArray(stations) || !stations.length) return [];

  const url = new URL(TOMTOM_EV_SEARCH_URL);
  url.searchParams.set('key', process.env.TOMTOM_API_KEY);
  url.searchParams.set('lat', String(center.lat));
  url.searchParams.set('lon', String(center.lng));
  url.searchParams.set('radius', String(clampRadiusMeters(radiusKm)));
  url.searchParams.set('limit', '100');
  url.searchParams.set('view', 'Unified');

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'es-ES'
      }
    });

    if (!response.ok) {
      console.warn(`TomTom EV Search failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .map(result => normalizeTomTomResult(result, stations))
      .filter(Boolean);
  } catch (error) {
    console.warn('TomTom EV Search unavailable', error);
    return [];
  }
}

async function getElectromapsAvailability() {
  if (!process.env.ELECTROMAPS_USERNAME || !process.env.ELECTROMAPS_PASSWORD) return [];

  // Placeholder for an official/authorized Electromaps integration.
  // Do not scrape or automate app login here unless Electromaps grants explicit permission.
  return [];
}

async function getReveAvailability() {
  if (!process.env.REVE_API_URL) return [];

  // Placeholder for REVE when a documented/API endpoint is available.
  // Expected normalized output:
  // [{ id, lat, lng, availableConns, totalConns, status, price, updatedAt, source }]
  return [];
}

async function getOcpiAvailability() {
  if (!process.env.OCPI_BASE_URL || !process.env.OCPI_TOKEN) return [];

  // Placeholder for OCPI 2.2.1 locations/status integration.
  // Map EVSE status values to: available | occupied | unavailable | unknown.
  return [];
}

function normalizeTomTomResult(result, stations) {
  const lat = Number(result?.position?.lat);
  const lng = Number(result?.position?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const match = findClosestStation({ lat, lng, name: result.name }, stations);
  if (!match) return null;

  const points = (result.chargingStations || [])
    .flatMap(station => Array.isArray(station.chargingPoints) ? station.chargingPoints : []);
  if (!points.length) return null;

  const availableConns = points.filter(point => point.status === 'Available').length;
  const knownConns = points.filter(point => point.status && point.status !== 'Unknown').length;
  const totalConns = points.length;

  return {
    id: String(match.id),
    lat,
    lng,
    availableConns,
    totalConns,
    status: knownConns ? (availableConns > 0 ? 'available' : 'occupied') : 'unknown',
    connectors: points.flatMap(point => normalizeTomTomConnectors(point)),
    updatedAt: new Date().toISOString(),
    source: 'TomTom'
  };
}

function normalizeTomTomConnectors(point) {
  const status = mapTomTomStatus(point.status);
  const connectors = Array.isArray(point.connectors) ? point.connectors : [];
  return connectors.map(connector => ({
    type: connector.type || 'Conector EV',
    kw: numberOrNull(connector.ratedPowerKW),
    status
  }));
}

function mapTomTomStatus(status) {
  if (status === 'Available') return 'available';
  if (['Occupied', 'Reserved', 'OutOfService'].includes(status)) return 'occupied';
  return 'unknown';
}

function findClosestStation(target, stations) {
  let best = null;
  for (const station of stations) {
    const distance = distanceMeters(target.lat, target.lng, Number(station.lat), Number(station.lng));
    if (!Number.isFinite(distance) || distance > 160) continue;
    const score = distance - nameSimilarityBonus(target.name, station.name);
    if (!best || score < best.score) best = { station, score };
  }
  return best?.station || null;
}

function nameSimilarityBonus(a, b) {
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (!left.length || !right.length) return 0;
  const shared = left.filter(word => right.includes(word)).length;
  return Math.min(shared * 15, 45);
}

function normalizedWords(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 2);
}

function clampRadiusMeters(radiusKm) {
  const meters = Math.round(Number(radiusKm || 5) * 1000);
  if (!Number.isFinite(meters)) return 5000;
  return Math.min(Math.max(meters, 1), 100000);
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const toRad = value => value * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
