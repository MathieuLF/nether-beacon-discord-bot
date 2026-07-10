const fs = require('fs');

const STATUS = {
  DOWN: 0,
  UP: 1,
  PENDING: 2,
  MAINTENANCE: 3,
};

const defaultState = () => ({
  version: 1,
  updatedAt: null,
  lastStatusKey: null,
  announcedEventRevisions: [],
  activeEvents: {},
});

const normalizeState = (value) => ({
  ...defaultState(),
  ...(value && typeof value === 'object' ? value : {}),
  announcedEventRevisions: Array.isArray(value?.announcedEventRevisions) ? value.announcedEventRevisions : [],
  activeEvents: value?.activeEvents && typeof value.activeEvents === 'object' ? value.activeEvents : {},
});

const loadUptimeKumaState = (statePath) => {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch (error) {
    return defaultState();
  }
};

const saveUptimeKumaState = (statePath, state) => {
  fs.writeFileSync(statePath, JSON.stringify(normalizeState(state), null, 2), 'utf8');
};

const parseStatusPageUrl = (value) => {
  const url = new URL(value);
  const parts = url.pathname.split('/').filter(Boolean);
  const statusIndex = parts.lastIndexOf('status');
  const slug = parts[statusIndex + 1];

  if (statusIndex === -1 || !slug) {
    throw new Error('BOT_UPTIME_KUMA_STATUS_PAGE_URL must look like https://host/status/slug');
  }

  const prefixParts = parts.slice(0, statusIndex);
  const prefix = prefixParts.length ? `/${prefixParts.join('/')}` : '';
  const origin = `${url.origin}${prefix}`;

  return {
    slug,
    pageUrl: `${origin}/status/${slug}`,
    statusApiUrl: `${origin}/api/status-page/${slug}`,
    heartbeatApiUrl: `${origin}/api/status-page/heartbeat/${slug}`,
  };
};

const fetchJson = async (url, fetchImpl, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const latestHeartbeat = (heartbeats = []) => {
  if (!Array.isArray(heartbeats) || heartbeats.length === 0) return null;

  return heartbeats.reduce((latest, heartbeat) => {
    if (!latest) return heartbeat;
    const latestTime = new Date(latest.time).getTime();
    const heartbeatTime = new Date(heartbeat.time).getTime();
    if (Number.isNaN(latestTime) || Number.isNaN(heartbeatTime)) return heartbeat;
    return heartbeatTime >= latestTime ? heartbeat : latest;
  }, null);
};

const flattenMonitors = (publicGroupList = []) =>
  publicGroupList.flatMap((group) =>
    (group.monitorList || []).map((monitor) => ({
      ...monitor,
      groupName: group.name,
    })),
  );

const normalizeOverallStatus = (statuses) => {
  if (!statuses.length) return 'unknown';
  if (statuses.some((status) => status === STATUS.DOWN)) return 'down';
  if (statuses.some((status) => status === STATUS.MAINTENANCE)) return 'maintenance';
  if (statuses.every((status) => status === STATUS.UP)) return 'up';
  if (statuses.some((status) => status === STATUS.PENDING)) return 'pending';
  return 'unknown';
};

const normalizeIncidents = (pageData) => {
  if (Array.isArray(pageData.incidents)) return pageData.incidents;
  if (pageData.incident) return [pageData.incident];
  return [];
};

const normalizeMaintenanceList = (pageData) =>
  (pageData.maintenanceList || []).filter((maintenance) =>
    maintenance?.active !== false &&
    !['ended', 'inactive'].includes(String(maintenance?.status || '').toLowerCase()),
  );

const compactDate = (value) => (value ? String(value) : '');

const eventIdentity = (type, event) => `${type}:${event.id ?? event.title ?? 'unknown'}`;

const maintenanceRevision = (maintenance) => {
  const timeslot = maintenance.timeslotList?.[0] || {};
  return [
    eventIdentity('maintenance', maintenance),
    maintenance.status || '',
    maintenance.updatedDate || maintenance.lastUpdatedDate || '',
    compactDate(timeslot.startDate),
    compactDate(timeslot.endDate),
    maintenance.title || '',
  ].join('|');
};

const incidentRevision = (incident) => [
  eventIdentity('incident', incident),
  incident.style || '',
  incident.updatedDate || incident.lastUpdatedDate || incident.createdDate || '',
  incident.title || '',
].join('|');

const normalizeEvents = (pageData) => [
  ...normalizeMaintenanceList(pageData).map((maintenance) => ({
    type: 'maintenance',
    identity: eventIdentity('maintenance', maintenance),
    revision: maintenanceRevision(maintenance),
    title: maintenance.title || 'Maintenance Palworld',
    status: maintenance.status || 'active',
    description: maintenance.description || maintenance.content || '',
    timeslot: maintenance.timeslotList?.[0] || null,
  })),
  ...normalizeIncidents(pageData).map((incident) => ({
    type: 'incident',
    identity: eventIdentity('incident', incident),
    revision: incidentRevision(incident),
    title: incident.title || 'Événement Palworld',
    status: incident.style || 'info',
    description: incident.content || '',
    timeslot: null,
  })),
];

const buildSnapshot = (pageData, heartbeatData, endpoints) => {
  const monitors = flattenMonitors(pageData.publicGroupList || []);
  const monitorStates = monitors.map((monitor) => {
    const heartbeat = latestHeartbeat(heartbeatData.heartbeatList?.[monitor.id] || []);
    return {
      id: monitor.id,
      name: monitor.name,
      groupName: monitor.groupName,
      status: heartbeat?.status,
      time: heartbeat?.time || null,
      msg: heartbeat?.msg || '',
      ping: heartbeat?.ping ?? null,
    };
  });
  const overallStatus = normalizeOverallStatus(
    monitorStates
      .map((monitor) => monitor.status)
      .filter((status) => Number.isInteger(status)),
  );

  return {
    title: pageData.config?.title || 'Palworld',
    pageUrl: endpoints.pageUrl,
    overallStatus,
    statusKey: overallStatus,
    monitors: monitorStates,
    events: normalizeEvents(pageData),
    checkedAt: new Date().toISOString(),
  };
};

const fetchUptimeKumaSnapshot = async ({
  statusPageUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
}) => {
  if (!fetchImpl) throw new Error('fetch is not available in this Node runtime');
  const endpoints = parseStatusPageUrl(statusPageUrl);
  const [pageData, heartbeatData] = await Promise.all([
    fetchJson(endpoints.statusApiUrl, fetchImpl, timeoutMs),
    fetchJson(endpoints.heartbeatApiUrl, fetchImpl, timeoutMs),
  ]);

  return buildSnapshot(pageData, heartbeatData, endpoints);
};

const statusAnnouncement = (snapshot) => {
  const latest = snapshot.monitors.find((monitor) => monitor.time) || {};
  const commonLines = [
    `- **Page statut** : ${snapshot.pageUrl}`,
    `- **Dernier signal** : ${latest.time || 'non disponible'}`,
  ];

  if (snapshot.overallStatus === 'up') {
    return [
      `**🟢 ${snapshot.title} est actif**`,
      '',
      'Le serveur est détecté en ligne. Tu peux rejoindre la partie.',
      ...commonLines,
    ].join('\n');
  }

  if (snapshot.overallStatus === 'down') {
    return [
      `**🔴 ${snapshot.title} est inactif**`,
      '',
      "Le serveur ne répond pas au dernier contrôle d'Uptime Kuma.",
      ...commonLines,
    ].join('\n');
  }

  if (snapshot.overallStatus === 'maintenance') {
    return [
      `**🟠 ${snapshot.title} est en maintenance**`,
      '',
      "Uptime Kuma indique que le service est en maintenance.",
      ...commonLines,
    ].join('\n');
  }

  return null;
};

const formatEventStatus = (event) => {
  if (event.type === 'maintenance') {
    if (event.status === 'under-maintenance') return 'en cours';
    if (event.status === 'scheduled') return 'planifiée';
    return event.status;
  }
  return event.status;
};

const eventAnnouncement = (event, pageUrl) => {
  const label = event.type === 'maintenance' ? 'Maintenance Palworld' : 'Événement Palworld';
  const lines = [
    `**🟠 ${label}**`,
    '',
    `- **Titre** : ${event.title}`,
    `- **État** : ${formatEventStatus(event)}`,
  ];

  if (event.timeslot?.startDate) lines.push(`- **Début** : ${event.timeslot.startDate}`);
  if (event.timeslot?.endDate) lines.push(`- **Fin** : ${event.timeslot.endDate}`);
  lines.push(`- **Page statut** : ${pageUrl}`);

  return lines.join('\n');
};

const eventEndedAnnouncement = (event, pageUrl) => [
  `**✅ ${event.type === 'maintenance' ? 'Maintenance Palworld terminée' : 'Événement Palworld terminé'}**`,
  '',
  `- **Titre** : ${event.title}`,
  `- **Page statut** : ${pageUrl}`,
].join('\n');

const planUptimeKumaAnnouncements = (snapshot, previousState) => {
  const state = normalizeState(previousState);
  const messages = [];
  const nextActiveEvents = {};
  const announcedEventRevisions = new Set(state.announcedEventRevisions);

  if (['up', 'down', 'maintenance'].includes(snapshot.overallStatus) && state.lastStatusKey !== snapshot.statusKey) {
    const message = statusAnnouncement(snapshot);
    if (message) messages.push(message);
    state.lastStatusKey = snapshot.statusKey;
  }

  for (const event of snapshot.events) {
    nextActiveEvents[event.identity] = event;
    if (!announcedEventRevisions.has(event.revision)) {
      messages.push(eventAnnouncement(event, snapshot.pageUrl));
      announcedEventRevisions.add(event.revision);
    }
  }

  for (const [identity, previousEvent] of Object.entries(state.activeEvents)) {
    if (!nextActiveEvents[identity]) {
      messages.push(eventEndedAnnouncement(previousEvent, snapshot.pageUrl));
    }
  }

  return {
    messages,
    state: normalizeState({
      ...state,
      updatedAt: snapshot.checkedAt,
      activeEvents: nextActiveEvents,
      announcedEventRevisions: [...announcedEventRevisions].slice(-100),
    }),
  };
};

module.exports = {
  STATUS,
  buildSnapshot,
  defaultState,
  fetchUptimeKumaSnapshot,
  loadUptimeKumaState,
  normalizeEvents,
  parseStatusPageUrl,
  planUptimeKumaAnnouncements,
  saveUptimeKumaState,
};
