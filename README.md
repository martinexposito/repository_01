# CargaYa Availability Proxy

Backend local para servir la app `ev-charger_mtin.html` y preparar un conector de disponibilidad en tiempo real.

## 1. Configurar

```sh
cp .env.example .env
```

Edita `.env` si el HTML está en otra ruta:

```sh
STATIC_HTML_PATH=/Users/martinexposito/Downloads/ev-charger_mtin.html
PORT=8787
```

No pongas credenciales en el HTML. Las claves de proveedores, como TomTom, Electromaps, REVE u OCPI, van solo en `.env` o en las variables privadas de Render.

Para activar TomTom o HERE:

```sh
TOMTOM_API_KEY=tu_clave_de_tomtom
HERE_API_KEY=tu_clave_de_here
HERE_EV_BASE_URL=https://evcp.hereapi.com/v3
HERE_SEARCH_BASE_URL=https://browse.search.hereapi.com/v1
```

## 2. Arrancar

```sh
npm start
```

Abre:

```text
http://localhost:8787
```

Si quieres probar desde un iPhone en la misma Wi-Fi, abre:

```text
http://IP_DEL_MAC:8787
```

## 3. Endpoints

Salud:

```text
GET /health
```

Diagnóstico HERE:

```text
GET /debug/here?lat=52.5308&lng=13.3849&radiusKm=0.5
```

Disponibilidad:

```text
POST /api/availability
```

Entrada esperada:

```json
{
  "center": { "lat": 40.416, "lng": -3.703 },
  "radiusKm": 5,
  "stations": [
    {
      "id": "123",
      "name": "Estación EV",
      "lat": 40.416,
      "lng": -3.703,
      "operator": "Operador",
      "source": "Open Charge Map",
      "connectors": [{ "type": "CCS", "kw": 50 }]
    }
  ]
}
```

Salida normalizada:

```json
{
  "availability": [
    {
      "id": "123",
      "availableConns": 1,
      "totalConns": 2,
      "status": "available",
      "price": "0,39 €/kWh",
      "updatedAt": "2026-05-09T10:30:00Z",
      "source": "REVE"
    }
  ]
}
```

## 4. Próximo paso

Los proveedores TomTom y HERE ya están preparados. Consultan estaciones EV cerca del centro/radio solicitado y cruzan la disponibilidad con las estaciones de la app por cercanía.

Quedan como próximos proveedores autorizados:

- `getElectromapsAvailability`
- `getReveAvailability`
- `getOcpiAvailability`

Cada proveedor debe devolver objetos normalizados como los del ejemplo de salida.
