import React, { useEffect, useRef, useState } from 'react';

import { Badge } from '../components/ui';
import { C } from '../theme';

const DEFAULT_CENTER = { lat: -1.286389, lng: 36.817223 };
const DEFAULT_ZOOM = 11;
const FOCUS_ZOOM = 14;
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

function getProviderInitials(name) {
  return (name || 'P')
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getJobMarkerLabel(jobId) {
  return String(jobId || 'JOB').slice(-4).toUpperCase();
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
    <div style="min-width:220px;padding:4px 2px 2px;">
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

function FilterChip({ active, label, count, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${color}22` : 'rgba(255,255,255,.03)',
        border: `1px solid ${active ? `${color}55` : C.border}`,
        borderRadius: 999,
        color: active ? color : C.muted,
        padding: '7px 10px',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {label} ({count})
    </button>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.03)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 11px' }}>
      <div style={{ fontSize: 17, fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function MapState({ title, body, tone = 'muted' }) {
  const iconColor = tone === 'error' ? C.error : tone === 'success' ? C.green : C.orange;

  return (
    <div style={{ background: C.dark, borderRadius: 10, height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.border}`, flexDirection: 'column', gap: 8, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 32, color: iconColor }}>MAP</div>
      <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: 11, color: C.muted, maxWidth: 300, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function fitMapToData(map, google, jobs, providers) {
  const bounds = new google.maps.LatLngBounds();
  let pointCount = 0;

  jobs.forEach((job) => {
    const location = getJobLocation(job);
    if (!location) return;
    bounds.extend(location);
    pointCount += 1;

    const providerLocation = normalizeCoordinate(job.providerLat, job.providerLng);
    if (!providerLocation) return;
    bounds.extend(providerLocation);
    pointCount += 1;
  });

  providers.forEach((provider) => {
    const location = getProviderLocation(provider);
    if (!location) return;
    bounds.extend(location);
    pointCount += 1;
  });

  if (pointCount === 0) {
    map.setCenter(DEFAULT_CENTER);
    map.setZoom(DEFAULT_ZOOM);
    return;
  }

  if (pointCount === 1) {
    map.setCenter(bounds.getCenter());
    map.setZoom(13);
    return;
  }

  map.fitBounds(bounds, MAP_PADDING);
}

export default function MapPage({ jobs, providers, onAIDispatch }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const infoWindowRef = useRef(null);
  const overlaysRef = useRef([]);
  const markerRegistryRef = useRef(new Map());

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [showSearchingJobs, setShowSearchingJobs] = useState(true);
  const [showAssignedJobs, setShowAssignedJobs] = useState(true);
  const [showAvailableProviders, setShowAvailableProviders] = useState(true);
  const [showBusyProviders, setShowBusyProviders] = useState(true);
  const [showOfflineProviders, setShowOfflineProviders] = useState(false);

  const mapsKey = process.env.REACT_APP_MAPS_KEY?.trim();
  const activeJobs = jobs.filter(job => !['completed', 'cancelled'].includes(job.status));
  const visibleJobs = activeJobs
    .filter((job) => {
      if (job.status === 'searching') return showSearchingJobs;
      return showAssignedJobs;
    })
    .sort((left, right) => {
      if (left.status === right.status) return 0;
      if (left.status === 'searching') return -1;
      if (right.status === 'searching') return 1;
      return 0;
    });

  const mappedProviders = providers.filter(provider => getProviderLocation(provider));
  const visibleProviders = mappedProviders.filter((provider) => {
    const displayStatus = getProviderDisplayStatus(provider, activeJobs);
    if (displayStatus === 'available') return showAvailableProviders;
    if (displayStatus === 'offline') return showOfflineProviders;
    return showBusyProviders;
  });

  const searchingCount = activeJobs.filter(job => job.status === 'searching').length;
  const assignedJobCount = activeJobs.length - searchingCount;
  const availableProviderCount = mappedProviders.filter(provider => getProviderDisplayStatus(provider, activeJobs) === 'available').length;
  const busyProviderCount = mappedProviders.filter(provider => !['available', 'offline'].includes(getProviderDisplayStatus(provider, activeJobs))).length;
  const offlineProviderCount = mappedProviders.filter(provider => getProviderDisplayStatus(provider, activeJobs) === 'offline').length;

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
    markerRegistryRef.current = new Map();

    visibleJobs.forEach((job) => {
      const jobLocation = getJobLocation(job);
      if (!jobLocation) return;

      const accent = STATUS_COLORS[job.status] || C.orange;
      const marker = new google.maps.Marker({
        map,
        position: jobLocation,
        title: `${job.id} ${job.serviceName || job.serviceId || 'Job'}`,
        icon: createMarkerIcon(google, accent, 14),
        label: {
          text: getJobMarkerLabel(job.id),
          color: '#08111D',
          fontSize: '10px',
          fontWeight: '700',
        },
      });

      marker.addListener('click', () => {
        infoWindowRef.current?.setContent(renderInfoWindowContent(
          `${job.id} - ${job.serviceName || job.serviceId || 'Roadside job'}`,
          [
            `${job.motoristName || 'Motorist'} - ${String(job.status || '').toUpperCase()}`,
            job.address,
            `KES ${Number(job.price || 0).toLocaleString()}`,
            job.providerName ? `Assigned to ${job.providerName}` : 'No provider assigned yet',
          ],
          accent,
        ));
        infoWindowRef.current?.open({ anchor: marker, map });
      });

      overlaysRef.current.push(marker);
      markerRegistryRef.current.set(`job:${job.id}`, marker);

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
    });

    visibleProviders.forEach((provider) => {
      const providerLocation = getProviderLocation(provider);
      if (!providerLocation) return;

      const displayStatus = getProviderDisplayStatus(provider, activeJobs);
      const accent = STATUS_COLORS[displayStatus] || STATUS_COLORS.offline;
      const marker = new google.maps.Marker({
        map,
        position: providerLocation,
        title: provider.name || 'Provider',
        icon: createMarkerIcon(google, accent, 10),
        label: {
          text: getProviderInitials(provider.name),
          color: '#08111D',
          fontSize: '10px',
          fontWeight: '700',
        },
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
      markerRegistryRef.current.set(`provider:${provider.id}`, marker);
    });

    fitMapToData(map, google, visibleJobs, visibleProviders);
    return undefined;
  }, [activeJobs, mapReady, visibleJobs, visibleProviders]);

  function refitMap() {
    const google = window.google;
    const map = mapInstanceRef.current;
    if (!mapReady || !google?.maps || !map) return;
    fitMapToData(map, google, visibleJobs, visibleProviders);
  }

  function focusJob(jobId) {
    const google = window.google;
    const map = mapInstanceRef.current;
    const marker = markerRegistryRef.current.get(`job:${jobId}`);
    if (!google?.maps || !map || !marker) return;
    map.panTo(marker.getPosition());
    map.setZoom(Math.max(map.getZoom() || DEFAULT_ZOOM, FOCUS_ZOOM));
    google.maps.event.trigger(marker, 'click');
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 13 }}>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
          <MiniStat label="Visible Jobs" value={visibleJobs.length} color={C.orange} />
          <MiniStat label="Searching" value={searchingCount} color={C.orange} />
          <MiniStat label="Available" value={availableProviderCount} color={C.green} />
          <MiniStat label="Busy Providers" value={busyProviderCount} color={C.blue} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 9 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Live Dispatch Map - Nairobi</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Job markers show the job id. Provider markers show initials.
            </div>
          </div>
          <button
            onClick={refitMap}
            style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 11, cursor: 'pointer' }}
          >
            Refit map
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <FilterChip active={showSearchingJobs} label="Searching jobs" count={searchingCount} color={C.orange} onClick={() => setShowSearchingJobs(value => !value)} />
          <FilterChip active={showAssignedJobs} label="Assigned jobs" count={assignedJobCount} color={C.blue} onClick={() => setShowAssignedJobs(value => !value)} />
          <FilterChip active={showAvailableProviders} label="Available providers" count={availableProviderCount} color={C.green} onClick={() => setShowAvailableProviders(value => !value)} />
          <FilterChip active={showBusyProviders} label="Busy providers" count={busyProviderCount} color={C.blue} onClick={() => setShowBusyProviders(value => !value)} />
          <FilterChip active={showOfflineProviders} label="Offline providers" count={offlineProviderCount} color={C.muted} onClick={() => setShowOfflineProviders(value => !value)} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,.03)' }}>
              <div style={{ fontSize: 11, color: C.muted }}>
                {mapReady ? `${visibleJobs.length} visible jobs | ${visibleProviders.length} visible providers` : 'Loading live map...'}
              </div>
              <div style={{ fontSize: 11, color: C.green }}>
                {mapReady ? 'Live' : 'Connecting'}
              </div>
            </div>
            <div ref={mapContainerRef} style={{ height: 460, width: '100%', background: C.dark }} />
          </div>
        )}
      </div>

      <div style={{ overflow: 'auto', maxHeight: 620 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 9 }}>
          Visible Jobs ({visibleJobs.length})
        </div>

        {visibleJobs.length === 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 12px', color: C.muted, fontSize: 12, marginBottom: 12 }}>
            No jobs match the current filters.
          </div>
        )}

        {visibleJobs.map(job => (
          <div key={job.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: C.orange }}>{job.id}</span>
              <Badge label={job.status?.toUpperCase()} color={job.status === 'searching' ? 'orange' : 'blue'} />
            </div>
            <div style={{ fontSize: 12, color: C.text, margin: '3px 0' }}>{job.motoristName}</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{job.address}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
              <span style={{ color: C.orange, fontWeight: 500 }}>KES {job.price?.toLocaleString()}</span>
              <span style={{ color: C.muted }}>{job.serviceName || job.serviceId}</span>
            </div>
            {job.providerName && (
              <div style={{ fontSize: 11, color: C.blue, marginTop: 6 }}>Assigned: {job.providerName}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => focusJob(job.id)}
                style={{ flex: 1, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', fontSize: 11, color: C.text, cursor: 'pointer' }}
              >
                Focus on map
              </button>
              {job.status === 'searching' && (
                <button
                  onClick={() => onAIDispatch(job)}
                  style={{ flex: 1, background: 'rgba(232,99,26,.1)', border: '1px solid rgba(232,99,26,.2)', borderRadius: 7, padding: '7px 10px', fontSize: 11, color: C.orange, cursor: 'pointer' }}
                >
                  Ask AI
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
