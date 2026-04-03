import React, { useEffect, useRef, useState } from 'react';

import { Badge } from '../components/ui';
import { C } from '../theme';

const DEFAULT_CENTER = { lat: -1.286389, lng: 36.817223 };
const DEFAULT_ZOOM = 11;
const MAP_PADDING = 56;

const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#08111D' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9CA9BA' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#08111D' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#11233A' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#0F1C2E' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0C241C' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#142235' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#1B2E45' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#20395A' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0B2942' }] },
];

const STATUS_COLORS = {
  available: C.green,
  searching: C.orange,
  matched: C.blue,
  en_route: C.blue,
  on_site: C.yellow,
  in_progress: C.orange,
  on_job: C.blue,
  offline: '#65758B',
};

let mapsLoaderPromise = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCoordinate(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function getJobLocation(job) {
  return normalizeCoordinate(job?.lat, job?.lng);
}

function getProviderLocation(provider) {
  return normalizeCoordinate(
    provider?.location?.lat ?? provider?.lat,
    provider?.location?.lng ?? provider?.lng,
  );
}

function getProviderJobStatus(activeJobs, providerId) {
  if (!providerId) return null;
  const activeJob = activeJobs.find(job => job.providerId === providerId);
  return activeJob?.status || null;
}

function getProviderDisplayStatus(provider, activeJobs) {
  return getProviderJobStatus(activeJobs, provider.id) || provider.status || 'offline';
}

function createMarkerIcon(google, color, scale) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#08111D',
    strokeWeight: 2,
    scale,
  };
}

function renderInfoWindowContent(title, lines, accent) {
  const content = lines
    .filter(Boolean)
    .map(line => `<div style="font-size:12px;color:#D7E0EA;line-height:1.45;">${escapeHtml(line)}</div>`)
    .join('');

  return `
    <div style="min-width:200px;padding:4px 2px 2px;">
      <div style="font-size:13px;font-weight:600;color:${accent};margin-bottom:6px;">${escapeHtml(title)}</div>
      ${content}
    </div>
  `;
}

function loadGoogleMaps(apiKey) {
  if (!apiKey) {
    return Promise.reject(new Error('REACT_APP_MAPS_KEY is missing'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  if (mapsLoaderPromise) {
    return mapsLoaderPromise;
  }

  mapsLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-roadready-google-maps="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Could not load Google Maps')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.roadreadyGoogleMaps = 'true';
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Could not load Google Maps'));
    document.head.appendChild(script);
  }).catch((error) => {
    mapsLoaderPromise = null;
    throw error;
  });

  return mapsLoaderPromise;
}

function MapState({ title, body, tone = 'muted' }) {
  const iconColor = tone === 'error' ? C.error : tone === 'success' ? C.green : C.orange;

  return (
    <div style={{ background: C.dark, borderRadius: 10, height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.border}`, flexDirection: 'column', gap: 8, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 32, color: iconColor }}>M</div>
      <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 11, color: C.muted, maxWidth: 280, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

export default function MapPage({ jobs, providers, onAIDispatch }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const infoWindowRef = useRef(null);
  const overlaysRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');

  const mapsKey = process.env.REACT_APP_MAPS_KEY?.trim();
  const activeJobs = jobs.filter(job => !['completed', 'cancelled'].includes(job.status));
  const mappedProviders = providers.filter(provider => getProviderLocation(provider));
  const trackedProviders = mappedProviders.filter(provider => getProviderDisplayStatus(provider, activeJobs) !== 'offline');

  useEffect(() => {
    let cancelled = false;

    if (!mapsKey) {
      setMapReady(false);
      setMapError('');
      return undefined;
    }

    loadGoogleMaps(mapsKey)
      .then((google) => {
        if (cancelled || !mapContainerRef.current) return;

        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new google.maps.Map(mapContainerRef.current, {
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
            disableDefaultUI: true,
            zoomControl: true,
            streetViewControl: false,
            fullscreenControl: false,
            mapTypeControl: false,
            styles: MAP_STYLES,
          });
          infoWindowRef.current = new google.maps.InfoWindow();
        }

        setMapError('');
        setMapReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setMapReady(false);
        setMapError(error.message || 'Could not load Google Maps');
      });

    return () => {
      cancelled = true;
    };
  }, [mapsKey]);

  useEffect(() => {
    const google = window.google;
    const map = mapInstanceRef.current;

    if (!mapReady || !google?.maps || !map) {
      return undefined;
    }

    overlaysRef.current.forEach(overlay => overlay.setMap(null));
    overlaysRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let pointCount = 0;

    activeJobs.forEach((job) => {
      const jobLocation = getJobLocation(job);
      if (!jobLocation) return;

      const accent = STATUS_COLORS[job.status] || C.orange;
      const marker = new google.maps.Marker({
        map,
        position: jobLocation,
        title: `${job.id} ${job.serviceName || job.serviceId || 'Job'}`,
        icon: createMarkerIcon(google, accent, 10),
      });

      marker.addListener('click', () => {
        infoWindowRef.current?.setContent(renderInfoWindowContent(
          `${job.id} · ${job.serviceName || job.serviceId || 'Roadside job'}`,
          [
            `${job.motoristName || 'Motorist'} · ${String(job.status || '').toUpperCase()}`,
            job.address,
            `KES ${Number(job.price || 0).toLocaleString()}`,
            job.providerName ? `Assigned to ${job.providerName}` : 'No provider assigned yet',
          ],
          accent,
        ));
        infoWindowRef.current?.open({ anchor: marker, map });
      });

      overlaysRef.current.push(marker);
      bounds.extend(jobLocation);
      pointCount += 1;

      const providerLocation = normalizeCoordinate(job.providerLat, job.providerLng);
      if (!providerLocation) return;

      const assignmentLine = new google.maps.Polyline({
        map,
        path: [jobLocation, providerLocation],
        strokeColor: accent,
        strokeOpacity: 0.6,
        strokeWeight: 3,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 1,
              scale: 3,
            },
            offset: '0',
            repeat: '12px',
          },
        ],
      });

      overlaysRef.current.push(assignmentLine);
      bounds.extend(providerLocation);
      pointCount += 1;
    });

    mappedProviders.forEach((provider) => {
      const providerLocation = getProviderLocation(provider);
      if (!providerLocation) return;

      const displayStatus = getProviderDisplayStatus(provider, activeJobs);
      const accent = STATUS_COLORS[displayStatus] || STATUS_COLORS.offline;
      const marker = new google.maps.Marker({
        map,
        position: providerLocation,
        title: provider.name || 'Provider',
        icon: createMarkerIcon(google, accent, 7),
      });

      marker.addListener('click', () => {
        infoWindowRef.current?.setContent(renderInfoWindowContent(
          provider.name || 'Provider',
          [
            `Status: ${String(displayStatus).replace('_', ' ')}`,
            Array.isArray(provider.skills) && provider.skills.length > 0 ? `Skills: ${provider.skills.join(', ')}` : null,
            `Rating: ${Number(provider.rating || 0).toFixed(1)}`,
            provider.phone || null,
          ],
          accent,
        ));
        infoWindowRef.current?.open({ anchor: marker, map });
      });

      overlaysRef.current.push(marker);
      bounds.extend(providerLocation);
      pointCount += 1;
    });

    if (pointCount === 0) {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(DEFAULT_ZOOM);
      return undefined;
    }

    if (pointCount === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(13);
      return undefined;
    }

    map.fitBounds(bounds, MAP_PADDING);
    return undefined;
  }, [activeJobs, mappedProviders, mapReady]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 13 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Live Dispatch Map - Nairobi</span>
          <span style={{ fontSize: 11, color: C.muted }}>
            <span style={{ color: C.green }}>●</span> Available &nbsp;
            <span style={{ color: C.blue }}>●</span> Assigned &nbsp;
            <span style={{ color: C.orange }}>●</span> Searching
          </span>
        </div>

        {!mapsKey && (
          <MapState
            title="Google Maps key required"
            body="Set REACT_APP_MAPS_KEY locally and in Vercel project settings, then redeploy to unlock the live dispatch map."
          />
        )}

        {!!mapsKey && mapError && (
          <MapState
            title="Map failed to load"
            body={mapError}
            tone="error"
          />
        )}

        {!!mapsKey && !mapError && (
          <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 12px', borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,.03)' }}>
              <div style={{ fontSize: 11, color: C.muted }}>
                {mapReady ? `${activeJobs.length} active jobs · ${trackedProviders.length} tracked providers` : 'Loading live map...'}
              </div>
              <div style={{ fontSize: 11, color: C.green }}>
                {mapReady ? 'Live' : 'Connecting'}
              </div>
            </div>
            <div ref={mapContainerRef} style={{ height: 420, width: '100%', background: C.dark }} />
          </div>
        )}
      </div>

      <div style={{ overflow: 'auto', maxHeight: 470 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 9 }}>
          Active Jobs ({activeJobs.length})
        </div>
        {activeJobs.length === 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 12px', color: C.muted, fontSize: 12 }}>
            No active jobs right now. Provider markers will still appear on the map when live locations are available.
          </div>
        )}
        {activeJobs.map(job => (
          <div key={job.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: C.orange }}>{job.id}</span>
              <Badge label={job.status?.toUpperCase()} color={job.status === 'searching' ? 'orange' : 'blue'} />
            </div>
            <div style={{ fontSize: 12, color: C.text, margin: '3px 0' }}>{job.motoristName}</div>
            <div style={{ fontSize: 11, color: C.muted }}>Location: {job.address}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
              <span style={{ color: C.orange, fontWeight: 500 }}>KES {job.price?.toLocaleString()}</span>
              <span style={{ color: C.muted }}>{job.serviceName || job.serviceId}</span>
            </div>
            {job.providerName && (
              <div style={{ fontSize: 11, color: C.blue, marginTop: 6 }}>Assigned: {job.providerName}</div>
            )}
            {job.status === 'searching' && (
              <div onClick={() => onAIDispatch(job)} style={{ background: 'rgba(232,99,26,.1)', border: '1px solid rgba(232,99,26,.2)', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: C.orange, cursor: 'pointer', marginTop: 8, textAlign: 'center' }}>
                AI dispatch recommendation -&gt;
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
