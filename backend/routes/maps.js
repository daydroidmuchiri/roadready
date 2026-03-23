/**
 * RoadReady — Google Maps Integration
 *
 * Endpoints:
 *   POST /api/maps/eta          — distance + duration between two points
 *   POST /api/maps/geocode      — address string → lat/lng
 *   POST /api/maps/reverse      — lat/lng → address string
 *
 * Uses Google Maps Platform APIs:
 *   - Distance Matrix API  (ETA)
 *   - Geocoding API        (address lookup)
 *
 * Set GOOGLE_MAPS_SERVER_KEY in .env
 * This key is server-side only — never exposed to clients.
 * The mobile apps use a separate EXPO_PUBLIC_GOOGLE_MAPS_KEY.
 */

const express = require('express');
const router  = express.Router();
const {
  asyncHandler, ValidationError, ExternalServiceError,
} = require('../errors');

const MAPS_KEY   = process.env.GOOGLE_MAPS_SERVER_KEY;
const MAPS_BASE  = 'https://maps.googleapis.com/maps/api';

// ─── Helper: call Google Maps API ────────────────────────────────────────────

async function mapsRequest(endpoint, params) {
  if (!MAPS_KEY) {
    throw new ExternalServiceError('Google Maps', 'GOOGLE_MAPS_SERVER_KEY not configured');
  }

  const url = new URL(`${MAPS_BASE}/${endpoint}/json`);
  url.searchParams.set('key', MAPS_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new ExternalServiceError('Google Maps', `HTTP ${res.status}`);
  }

  const data = await res.json();

  if (data.status === 'REQUEST_DENIED') {
    throw new ExternalServiceError('Google Maps', data.error_message || 'Request denied — check your API key');
  }
  if (data.status === 'OVER_QUERY_LIMIT') {
    throw new ExternalServiceError('Google Maps', 'Quota exceeded — check billing in Google Cloud Console');
  }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new ExternalServiceError('Google Maps', `Status: ${data.status}`);
  }

  return data;
}

// ─── POST /api/maps/eta ───────────────────────────────────────────────────────
// Returns driving distance and duration between two GPS coordinates.
// Called by the mobile apps to show live ETA on tracking/navigation screens.

router.post('/eta', asyncHandler(async (req, res) => {
  const { originLat, originLng, destLat, destLng } = req.body;

  if (
    typeof originLat !== 'number' || typeof originLng !== 'number' ||
    typeof destLat   !== 'number' || typeof destLng   !== 'number'
  ) {
    throw new ValidationError('Validation failed', {
      coordinates: 'originLat, originLng, destLat, destLng must all be numbers',
    });
  }

  const data = await mapsRequest('distancematrix', {
    origins:      `${originLat},${originLng}`,
    destinations: `${destLat},${destLng}`,
    mode:         'driving',
    units:        'metric',
    departure_time: 'now',   // uses traffic data
    traffic_model:  'best_guess',
    region:       'ke',       // Kenya region bias
  });

  const element = data.rows?.[0]?.elements?.[0];

  if (!element || element.status !== 'OK') {
    // Fallback to straight-line estimate
    const R    = 6371;
    const dLat = (destLat - originLat) * Math.PI / 180;
    const dLng = (destLng - originLng) * Math.PI / 180;
    const a    = Math.sin(dLat/2)**2 + Math.cos(originLat*Math.PI/180)*Math.cos(destLat*Math.PI/180)*Math.sin(dLng/2)**2;
    const km   = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const mins = Math.round((km / 30) * 60);

    return res.json({
      durationMinutes: mins,
      durationText:    `~${mins} min`,
      distanceKm:      parseFloat(km.toFixed(1)),
      distanceText:    `${km.toFixed(1)} km`,
      source:          'estimate',
    });
  }

  // Use duration_in_traffic if available (requires Maps Platform billing)
  const duration = element.duration_in_traffic || element.duration;

  res.json({
    durationMinutes: Math.round(duration.value / 60),
    durationText:    duration.text,
    distanceKm:      parseFloat((element.distance.value / 1000).toFixed(1)),
    distanceText:    element.distance.text,
    source:          element.duration_in_traffic ? 'traffic' : 'maps',
  });
}));

// ─── POST /api/maps/geocode ───────────────────────────────────────────────────
// Converts an address string to lat/lng.
// Used when motorist manually types their location instead of using GPS.

router.post('/geocode', asyncHandler(async (req, res) => {
  const { address } = req.body;
  if (!address || typeof address !== 'string') {
    throw new ValidationError('Validation failed', { address: 'required string' });
  }

  const data = await mapsRequest('geocode', {
    address:  address,
    region:   'ke',
    bounds:   '-4.7,33.9|-0.4,41.9',   // Kenya bounding box
  });

  if (!data.results?.length) {
    return res.json({ results: [] });
  }

  res.json({
    results: data.results.slice(0, 5).map(r => ({
      address:     r.formatted_address,
      lat:         r.geometry.location.lat,
      lng:         r.geometry.location.lng,
      placeId:     r.place_id,
    })),
  });
}));

// ─── POST /api/maps/reverse ───────────────────────────────────────────────────
// Converts lat/lng to a formatted address string.

router.post('/reverse', asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new ValidationError('Validation failed', { coordinates: 'lat and lng must be numbers' });
  }

  const data = await mapsRequest('geocode', {
    latlng: `${lat},${lng}`,
    result_type: 'street_address|route|neighborhood',
    region: 'ke',
  });

  const best = data.results?.[0];
  res.json({
    address: best?.formatted_address || null,
    components: best?.address_components || [],
  });
}));

module.exports = router;
