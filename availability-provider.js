export async function getAvailability({ stations }) {
  const providerResults = await Promise.allSettled([
    getElectromapsAvailability({ stations }),
    getReveAvailability({ stations }),
    getOcpiAvailability({ stations })
  ]);

  return providerResults
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => result.value);
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
