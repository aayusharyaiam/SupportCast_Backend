import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const metrics = {
  activeSessions: new Gauge({
    name: 'active_sessions_total',
    help: 'Number of currently active sessions',
    registers: [registry]
  }),
  connectedParticipants: new Gauge({
    name: 'connected_participants_total',
    help: 'Total connected participants across all sessions',
    registers: [registry]
  }),
  messagesSent: new Counter({
    name: 'messages_sent_total',
    help: 'Total chat messages sent',
    registers: [registry]
  }),
  recordingErrors: new Counter({
    name: 'recording_errors_total',
    help: 'Total recording failures',
    registers: [registry]
  }),
  sessionDuration: new Histogram({
    name: 'session_duration_seconds',
    help: 'Session duration in seconds',
    buckets: [30, 60, 300, 600, 1800, 3600],
    registers: [registry]
  })
};

export const metricsService = {
  contentType: () => registry.contentType,
  render: () => registry.metrics()
};
