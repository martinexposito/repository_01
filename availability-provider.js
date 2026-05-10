const TOMTOM_EV_SEARCH_URL = 'https://api.tomtom.com/search/2/evsearch';
const DEFAULT_PLUGSURFING_BASE_URL = 'https://drive-api-stage.plugsurfing.com/drive';
const DEFAULT_HERE_EV_BASE_URL = 'https://evcp.hereapi.com/v3';
const DEFAULT_HERE_SEARCH_BASE_URL = 'https://browse.search.hereapi.com/v1';

export function getProviderDiagnostics() {
  return {
    tomtom: {
      configured: Boolean(process.env.TOMTOM_API_KEY),
      keyLength: process.env.TOMTOM_API_KEY ? process.env.TOMTOM_API_KEY.length : 0
    },
    plugsurfing: {
      configured: Boolean(process.env.PLUGSURFING_API_KEY),
      keyLength: process.env.PLUGSURFING_API_KEY ? process.env.PLUGSURFING_API_KEY.length : 0,
      baseUrl: getPlugsurfingBaseUrl()
    },
    here: {
      configured: Boolean(process.env.HERE_API_KEY),
      keyLength: process.env.HERE_API_KEY ? process.env.HERE_API_KEY.length : 0,
      evBaseUrl: getHereEvBaseUrl(),
      searchBaseUrl: getHereSearchBaseUrl()
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

export async function getHereDiagnostics({ lat = 52.5308, lng = 13.3849, radiusKm = 0.5 } = {}) {
  if (!process.env.HERE_API_KEY) {
    return {
      configured: false,
      error: 'HERE_API_KEY is not configured'
    };
  }

  const url = buildHereSearchUrl({ lat, lng, radiusKm });
  try {
    const startedAt = Date.now();
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    const elapsedMs = Date.now() - startedAt;
    const body = parseJson(text);
    const items = getHereStations(body);
    return {
      configured: true,
      request: {
        lat: Number(lat),
        lng: Number(lng),
        radiusMeters: clampRadiusMeters(radiusKm),
        evBaseUrl: getHereEvBaseUrl(),
        searchBaseUrl: getHereSearchBaseUrl()
      },
      search: {
        status: response.status,
        ok: response.ok,
        elapsedMs,
        contentType: response.headers.get('content-type'),
        resultCount: items.length,
        error: response.ok ? null : summarizeProviderError(body, text),
        sample: items.slice(0, 5).map(summarizeHereSearchItem)
      }
    };
  } catch (error) {
    return {
      configured: true,
      error: error.message
    };
  }
}

export async function getPlugsurfingDiagnostics({ lat = 40.416775, lng = -3.70379, radiusKm = 5 } = {}) {
  if (!process.env.PLUGSURFING_API_KEY) {
    return {
      configured: false,
      error: 'PLUGSURFING_API_KEY is not configured'
    };
  }

  const url = buildPlugsurfingGeosearchUrl({ lat, lng, radiusKm });
  try {
    const startedAt = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: plugsurfingHeaders(),
      body: '{}'
    });
    const text = await response.text();
    const elapsedMs = Date.now() - startedAt;
    const body = parseJson(text);
    const locations = Array.isArray(body?.locations) ? body.locations : [];

    return {
      configured: true,
      request: {
        lat: Number(lat),
        lng: Number(lng),
        radiusMeters: clampRadiusMeters(radiusKm),
        limit: 100,
        baseUrl: getPlugsurfingBaseUrl()
      },
      response: {
        status: response.status,
        ok: response.ok,
        elapsedMs,
        contentType: response.headers.get('content-type'),
        resultCount: locations.length,
        error: response.ok ? null : summarizeProviderError(body, text),
        sample: locations.slice(0, 5).map(summarizePlugsurfingLocation)
      }
    };
  } catch (error) {
    return {
      configured: true,
      error: error.message
    };
  }
}

export async function getTomTomDiagnostics({ lat = 40.416775, lng = -3.70379, radiusKm = 5 } = {}) {
  if (!process.env.TOMTOM_API_KEY) {
    return {
      configured: false,
      error: 'TOMTOM_API_KEY is not configured'
    };
  }

  const url = buildTomTomEvSearchUrl({ lat, lng, radiusKm });
  try {
    const startedAt = Date.now();
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'es-ES'
      }
    });
    const text = await response.text();
    const elapsedMs = Date.now() - startedAt;
    const body = parseJson(text);
    const results = Array.isArray(body?.results) ? body.results : [];

    return {
      configured: true,
      request: {
        lat: Number(lat),
        lng: Number(lng),
        radiusMeters: clampRadiusMeters(radiusKm),
        limit: 100
      },
      response: {
        status: response.status,
        ok: response.ok,
        elapsedMs,
        contentType: response.headers.get('content-type'),
        summary: body?.summary || null,
        resultCount: results.length,
        error: response.ok ? null : summarizeTomTomError(body, text),
        sample: results.slice(0, 5).map(summarizeTomTomResult)
      }
    };
  } catch (error) {
    return {
      configured: true,
      error: error.message
    };
  }
}

export async function getAvailability({ center, radiusKm, stations }) {
  const providerResults = await Promise.allSettled([
    getHereAvailability({ center, radiusKm, stations }),
    getTomTomAvailability({ center, radiusKm, stations }),
    getPlugsurfingAvailability({ center, radiusKm, stations }),
    getElectromapsAvailability({ stations }),
    getReveAvailability({ stations }),
    getOcpiAvailability({ stations })
  ]);

  return providerResults
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
}

async function getHereAvailability({ center, radiusKm, stations }) {
  if (!process.env.HERE_API_KEY) return [];
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return [];
  if (!Array.isArray(stations) || !stations.length) return [];

  try {
    const response = await fetch(buildHereSearchUrl({
      lat: center.lat,
      lng: center.lng,
      radiusKm
    }), {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      console.warn(`HERE EV Charge Points failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    return getHereStations(data)
      .map(item => normalizeHereStation(item, stations))
      .filter(Boolean);
  } catch (error) {
    console.warn('HERE EV Charge Points unavailable', error);
    return [];
  }
}

async function getPlugsurfingAvailability({ center, radiusKm, stations }) {
  if (!process.env.PLUGSURFING_API_KEY) return [];
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return [];
  if (!Array.isArray(stations) || !stations.length) return [];

  try {
    const response = await fetch(buildPlugsurfingGeosearchUrl({
      lat: center.lat,
      lng: center.lng,
      radiusKm
    }), {
      method: 'POST',
      headers: plugsurfingHeaders(),
      body: '{}'
    });

    if (!response.ok) {
      console.warn(`Plugsurfing Geosearch failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    const locations = Array.isArray(data.locations) ? data.locations : [];
    return locations
      .map(location => normalizePlugsurfingLocation(location, stations))
      .filter(Boolean);
  } catch (error) {
    console.warn('Plugsurfing Geosearch unavailable', error);
    return [];
  }
}

async function getTomTomAvailability({ center, radiusKm, stations }) {
  if (!process.env.TOMTOM_API_KEY) return [];
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return [];
  if (!Array.isArray(stations) || !stations.length) return [];

  const url = buildTomTomEvSearchUrl({
    lat: center.lat,
    lng: center.lng,
    radiusKm
  });

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

function buildHereSearchUrl({ lat, lng, radiusKm }) {
  const url = new URL(`${getHereSearchBaseUrl()}/browse`);
  url.searchParams.set('apiKey', process.env.HERE_API_KEY);
  url.searchParams.set('at', `${lat},${lng}`);
  url.searchParams.set('in', `circle:${lat},${lng};r=${clampRadiusMeters(radiusKm)}`);
  url.searchParams.set('categories', '700-7600-0322');
  url.searchParams.set('show', 'ev');
  url.searchParams.set('limit', '100');
  url.searchParams.set('lang', 'es-ES');
  return url;
}

function getHereEvBaseUrl() {
  return (process.env.HERE_EV_BASE_URL || DEFAULT_HERE_EV_BASE_URL).replace(/\/+$/, '');
}

function getHereSearchBaseUrl() {
  return (process.env.HERE_SEARCH_BASE_URL || DEFAULT_HERE_SEARCH_BASE_URL).replace(/\/+$/, '');
}

function buildPlugsurfingGeosearchUrl({ lat, lng, radiusKm }) {
  const url = new URL(`${getPlugsurfingBaseUrl()}/v1/geosearch/radius`);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('distance', String(clampRadiusMeters(radiusKm)));
  url.searchParams.set('limit', '100');
  url.searchParams.set('language', 'es');
  return url;
}

function getPlugsurfingBaseUrl() {
  return (process.env.PLUGSURFING_BASE_URL || DEFAULT_PLUGSURFING_BASE_URL).replace(/\/+$/, '');
}

function plugsurfingHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-API-Key': process.env.PLUGSURFING_API_KEY
  };
}

function buildTomTomEvSearchUrl({ lat, lng, radiusKm }) {
  const url = new URL(TOMTOM_EV_SEARCH_URL);
  url.searchParams.set('key', process.env.TOMTOM_API_KEY);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('radius', String(clampRadiusMeters(radiusKm)));
  url.searchParams.set('limit', '100');
  url.searchParams.set('view', 'Unified');
  return url;
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

function normalizeHereStation(station, stations) {
  const pos = getHerePosition(station);
  if (!pos) return null;

  const match = findClosestStation({ lat: pos.lat, lng: pos.lng, name: getHereName(station) }, stations);
  if (!match) return null;

  const evses = getHereEvses(station);
  const chargingGroups = getHereChargingGroups(station);
  const statusItems = evses.length ? evses : chargingGroups;
  const knownItems = statusItems.filter(item => getHereStatus(item) !== 'unknown');
  const availableFromGroups = chargingGroups.reduce((sum, group) => sum + numberOrZero(group?.chargingPoint?.numberOfAvailable), 0);
  const totalFromGroups = chargingGroups.reduce((sum, group) => sum + numberOrZero(group?.chargingPoint?.numberOfConnectors), 0);
  const availableFromStatus = statusItems.filter(item => getHereStatus(item) === 'available').length;
  const availableConns = totalFromGroups ? availableFromGroups : availableFromStatus;
  const totalConns = totalFromGroups || Math.max(statusItems.length, 1);

  return {
    id: String(match.id),
    lat: pos.lat,
    lng: pos.lng,
    availableConns,
    totalConns,
    status: knownItems.length ? (availableConns > 0 ? 'available' : 'occupied') : 'unknown',
    connectors: getHereConnectors(station, statusItems),
    updatedAt: getHereUpdatedAt(station, evses),
    source: 'HERE'
  };
}

function getHereStations(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.stations)) return body.stations;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function getHerePosition(station) {
  const lat = Number(
    station?.position?.lat ??
    station?.position?.latitude ??
    station?.location?.lat ??
    station?.location?.latitude ??
    station?.coordinates?.latitude ??
    station?.lat ??
    station?.latitude
  );
  const lng = Number(
    station?.position?.lng ??
    station?.position?.lon ??
    station?.position?.longitude ??
    station?.location?.lng ??
    station?.location?.lon ??
    station?.location?.longitude ??
    station?.coordinates?.longitude ??
    station?.lng ??
    station?.lon ??
    station?.longitude
  );
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function getHereName(station) {
  return station?.name || station?.title || station?.address?.label || station?.address?.street || 'HERE EV Station';
}

function getHereEvses(station) {
  const availabilityStations = Array.isArray(station?.extended?.evAvailability?.stations)
    ? station.extended.evAvailability.stations
    : [];
  const availabilityEvses = availabilityStations.flatMap(item => Array.isArray(item.evses) ? item.evses : []);
  if (availabilityEvses.length) return availabilityEvses;
  if (Array.isArray(station?.evses)) return station.evses;
  if (Array.isArray(station?.evse)) return station.evse;
  if (Array.isArray(station?.chargingPoints)) return station.chargingPoints;
  if (Array.isArray(station?.connectors)) return station.connectors;
  return [];
}

function getHereChargingGroups(station) {
  if (Array.isArray(station?.extended?.evStation?.connectors)) return station.extended.evStation.connectors;
  return [];
}

function getHereStatus(item) {
  const value = String(item?.state ?? item?.status ?? item?.availabilityStatus ?? item?.availability?.status ?? '').toUpperCase();
  if (['AVAILABLE', 'FREE'].includes(value)) return 'available';
  if (['CHARGING', 'OCCUPIED', 'BUSY', 'RESERVED', 'BLOCKED', 'INOPERATIVE', 'OFFLINE', 'OUTOFORDER', 'OUT_OF_ORDER', 'UNAVAILABLE'].includes(value)) return 'occupied';
  return 'unknown';
}

function getHereConnectors(station, statusItems) {
  const chargingGroups = getHereChargingGroups(station);
  const connectors = [
    ...(Array.isArray(station?.connectors) ? station.connectors : []),
    ...statusItems.flatMap(item => Array.isArray(item.connectors)
      ? item.connectors.map(connector => ({
        ...connector,
        state: connector.state || connector.status || item.state || item.status || item.availabilityStatus
      }))
      : [])
  ];
  const source = connectors.length ? connectors : (chargingGroups.length ? chargingGroups : statusItems);
  return source.map(item => ({
    type: item.connectorType?.name || item.connectorType || item.type || item.standard || `Tipo ${item.typeId || 'EV'}`,
    kw: numberOrNull(item.powerKW ?? item.powerKw ?? item.maxPowerKW ?? item.maxPowerLevel ?? (item.power ? Number(item.power) / 1000 : null)),
    status: getHereConnectorStatus(item)
  }));
}

function getHereConnectorStatus(item) {
  const status = getHereStatus(item);
  if (status !== 'unknown') return status;

  const available = numberOrNull(item?.chargingPoint?.numberOfAvailable);
  if (available === null) return 'unknown';
  return available > 0 ? 'available' : 'occupied';
}

function getHereUpdatedAt(station, evses) {
  return latestTimestamp([
    station?.updatedAt,
    station?.lastUpdated,
    station?.last_updated,
    ...evses.map(evse => evse.updatedAt || evse.lastUpdated || evse.last_updated)
  ]);
}

function summarizeHereStation(station) {
  const pos = getHerePosition(station);
  const evses = getHereEvses(station);
  const chargingGroups = getHereChargingGroups(station);
  const statuses = (evses.length ? evses : [station]).reduce((acc, item) => {
    const status = item?.state || item?.status || item?.availabilityStatus || item?.availability?.status || 'UNKNOWN';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return {
    id: station.id || station.stationId || null,
    name: getHereName(station),
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    evseCount: evses.length,
    connectorCount: station?.extended?.evStation?.totalNumberOfConnectors ?? null,
    connectorGroups: chargingGroups.length,
    statuses
  };
}

function summarizeHereSearchItem(item) {
  const pos = getHerePosition(item);
  return {
    id: item?.id || null,
    title: item?.title || item?.name || null,
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    resultType: item?.resultType || null,
    ev: summarizeHereStation(item),
    categories: Array.isArray(item?.categories)
      ? item.categories.map(category => category.id || category.name).filter(Boolean).slice(0, 5)
      : []
  };
}

function normalizePlugsurfingLocation(location, stations) {
  const lat = Number(location?.coordinates?.latitude);
  const lng = Number(location?.coordinates?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const match = findClosestStation({ lat, lng, name: location.name }, stations);
  if (!match) return null;

  const evses = Array.isArray(location.evses) ? location.evses : [];
  if (!evses.length) return null;

  const availableConns = evses.filter(evse => evse.status === 'AVAILABLE').length;
  const knownConns = evses.filter(evse => evse.status && evse.status !== 'UNKNOWN').length;
  const totalConns = evses.length;
  const updatedAt = latestTimestamp([
    location.last_updated,
    ...evses.map(evse => evse.last_updated)
  ]);

  return {
    id: String(match.id),
    lat,
    lng,
    availableConns,
    totalConns,
    status: knownConns ? (availableConns > 0 ? 'available' : 'occupied') : 'unknown',
    connectors: evses.flatMap(normalizePlugsurfingConnectors),
    updatedAt,
    source: 'Plugsurfing'
  };
}

function normalizePlugsurfingConnectors(evse) {
  const status = mapPlugsurfingStatus(evse.status);
  const connectors = Array.isArray(evse.connectors) ? evse.connectors : [];
  if (!connectors.length) {
    return [{
      type: 'Conector EV',
      kw: null,
      status
    }];
  }

  return connectors.map(connector => ({
    type: connector.standard || connector.type || 'Conector EV',
    kw: numberOrNull(connector.power ? Number(connector.power) / 1000 : null),
    status
  }));
}

function mapPlugsurfingStatus(status) {
  if (status === 'AVAILABLE') return 'available';
  if (['CHARGING', 'BLOCKED', 'OCCUPIED', 'RESERVED', 'INOPERATIVE', 'OFFLINE', 'OUTOFORDER', 'UNAVAILABLE'].includes(status)) return 'occupied';
  return 'unknown';
}

function summarizePlugsurfingLocation(location) {
  const evses = Array.isArray(location.evses) ? location.evses : [];
  const statuses = evses.reduce((acc, evse) => {
    const status = evse.status || 'UNKNOWN';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    id: location.id || null,
    name: location.name || null,
    lat: location.coordinates?.latitude ?? null,
    lng: location.coordinates?.longitude ?? null,
    evseCount: evses.length,
    statuses
  };
}

function summarizeTomTomResult(result) {
  const chargingPoints = (result.chargingStations || [])
    .flatMap(station => Array.isArray(station.chargingPoints) ? station.chargingPoints : []);
  const statuses = chargingPoints.reduce((acc, point) => {
    const status = point.status || 'Unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    id: result.id || null,
    name: result.name || null,
    lat: result.position?.lat ?? null,
    lng: result.position?.lon ?? null,
    chargingPointCount: chargingPoints.length,
    statuses
  };
}

function summarizeTomTomError(body, text) {
  return summarizeProviderError(body, text);
}

function summarizeProviderError(body, text) {
  if (body?.errorText) return body.errorText;
  if (body?.detailedError?.message) return body.detailedError.message;
  if (body?.message) return body.message;
  if (Array.isArray(body?.details)) return body.details.join('; ');
  return text ? text.slice(0, 240) : null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function latestTimestamp(values) {
  const valid = values
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(date => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return valid[0]?.toISOString() || new Date().toISOString();
}
