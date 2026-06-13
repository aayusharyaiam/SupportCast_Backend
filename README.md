# SupportCast Backend

Node.js backend for SupportCast, the AtomQuest Hackathon real-time video support platform.

The backend provides REST APIs, Socket.io signaling, mediasoup SFU rooms, Supabase persistence, invite-token customer auth, file upload signing, recording orchestration, admin APIs, health checks, metrics, and structured logging.

## Live Services

| Service | URL |
|---|---|
| Backend API | https://supportcast-backend.onrender.com |
| Health | https://supportcast-backend.onrender.com/health |
| Metrics | https://supportcast-backend.onrender.com/metrics |

## Tech Stack

| Area | Technology |
|---|---|
| Runtime | Node.js 20+ |
| HTTP | Express 5 |
| Realtime | Socket.io 4 |
| Media | mediasoup 3 SFU |
| Recording | FFmpeg via mediasoup PlainTransport |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth JWT and customer invite JWT |
| Storage | Supabase Storage |
| Validation | Zod |
| Logging | Winston JSON logs |
| Metrics | prom-client |
| Security | Helmet, CORS, express-rate-limit |

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase project with `supabase/schema.sql` applied
- FFmpeg for recording

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:5173

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

CUSTOMER_JWT_SECRET=your-16-char-min-secret-key
CUSTOMER_JWT_EXPIRES_IN=2h

MEDIASOUP_MIN_PORT=10000
MEDIASOUP_MAX_PORT=10100
MEDIASOUP_ANNOUNCED_IP=127.0.0.1

RECORDING_TEMP_DIR=/tmp/recordings
SUPABASE_STORAGE_BUCKET=recordings

LOG_LEVEL=info
```

### Commands

```bash
npm install
npm run dev
npm start
npm run lint
npm test
npm run seed
```

| Command | Description |
|---|---|
| `npm run dev` | Start backend with nodemon |
| `npm start` | Start backend with Node |
| `npm run lint` | Run ESLint |
| `npm test` | Run Jest with `--passWithNoTests` |
| `npm run seed` | Seed demo accounts, sessions, and chat history |

## REST API

### Auth

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Agent/admin login | Public |
| `POST` | `/api/v1/auth/logout` | Logout | Agent/Admin |

### Sessions

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/v1/sessions` | Create a support session | Agent/Admin |
| `GET` | `/api/v1/sessions` | List the agent's sessions | Agent/Admin |
| `GET` | `/api/v1/sessions/:id` | Get session details | Agent/Admin/Customer |
| `DELETE` | `/api/v1/sessions/:id` | End a session | Agent/Admin |
| `POST` | `/api/v1/sessions/join` | Validate invite and issue customer token | Public |
| `GET` | `/api/v1/sessions/:id/chat` | Get persisted chat history | Agent/Admin/Customer |
| `GET` | `/api/v1/sessions/:id/recording` | Get recording status | Agent/Admin |
| `POST` | `/api/v1/sessions/:id/files/signed-url` | Create signed upload URL | Agent/Admin/Customer |

### Admin

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/api/v1/admin/sessions/live` | List active sessions with participant details | Admin |
| `GET` | `/api/v1/admin/sessions/history` | Paginated history with date/search params | Admin |
| `DELETE` | `/api/v1/admin/sessions/:id` | Force-end a session | Admin |
| `POST` | `/api/v1/admin/agents` | Create an agent or admin account | Admin |
| `GET` | `/api/v1/admin/agents` | List agents and admins | Admin |
| `DELETE` | `/api/v1/admin/agents/:id` | Delete an agent/admin account | Admin |

### System

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Status, uptime, version, and service checks |
| `GET` | `/metrics` | Prometheus-compatible metrics |

## Socket.io Events

### Client to Server

| Event | Payload | Description |
|---|---|---|
| `join-session` | `{ sessionId, token, name }` | Join or reconnect to a session |
| `leave-session` | `{ sessionId }` | Leave a call cleanly without ending the session |
| `get-ice-servers` | none | Get STUN/TURN configuration |
| `get-rtp-capabilities` | `{ sessionId }` | Get mediasoup router RTP capabilities |
| `create-transport` | `{ sessionId, direction }` | Create send or receive WebRTC transport |
| `connect-transport` | `{ sessionId, transportId, dtlsParameters }` | Connect a transport |
| `produce` | `{ sessionId, transportId, kind, rtpParameters }` | Publish audio or video |
| `consume` | `{ sessionId, producerId, rtpCapabilities }` | Consume a remote producer |
| `resume-consumer` | `{ sessionId, consumerId }` | Resume a paused consumer |
| `send-chat` | `{ sessionId, message }` | Send a text chat message |
| `share-file` | `{ sessionId, fileName, fileUrl, fileSize, fileType }` | Send a file chat message |
| `mute-audio` | `{ sessionId, muted }` | Broadcast microphone mute state |
| `toggle-video` | `{ sessionId, enabled }` | Broadcast camera state |
| `start-recording` | `{ sessionId }` | Start recording; agent/admin only |
| `stop-recording` | `{ sessionId }` | Stop recording; agent/admin only |
| `end-session` | `{ sessionId }` | End the session; agent/admin only |

### Server to Client

| Event | Payload | Description |
|---|---|---|
| `participant-joined` | `{ participantId, name, role }` | Participant joined |
| `participant-left` | `{ participantId, name? }` | Participant left or grace timer expired |
| `new-producer` | `{ producerId, participantId, kind }` | New audio/video producer is available |
| `chat-message` | chat message object | Text or file chat message |
| `recording-status` | `{ sessionId, status, recordingId?, fileUrl? }` | Recording status changed |
| `participant-audio-muted` | `{ participantId, muted }` | Participant microphone state changed |
| `participant-video-toggled` | `{ participantId, enabled }` | Participant camera state changed |
| `session-ended` | `{ sessionId, endedBy }` | Session ended |

## Implemented Backend Features

### Session and Auth

- Supabase Auth for agents and admins.
- Customer invite token validation and short-lived JWT issuance.
- Role checks on REST routes and Socket.io handlers.
- Session lifecycle persistence and event logging.

### Media SFU

- mediasoup Worker and Router initialized on server start.
- Send and receive WebRTC transports for each participant.
- Opus audio and VP8 video routed through the SFU.
- Producer/consumer creation, resume, and cleanup.
- Audio-only fallback supported by the same transport flow.

### Chat and File Sharing

- Socket.io real-time chat.
- Chat persistence in Supabase.
- File type and size validation.
- Signed upload URLs for Supabase Storage.
- File messages persisted with metadata and available after the call.

### Recording

- Agent/admin-controlled recording start and stop.
- RTP routed from mediasoup PlainTransport into FFmpeg.
- Recording metadata saved in the `recordings` table.
- Completed recordings uploaded to Supabase Storage.
- Recording error state and metrics are tracked.

### Reconnect and Leave Handling

- Unexpected disconnects start a 10-second in-memory grace timer.
- Other participants are not notified during the grace window.
- Reconnect clears the timer and restores existing mediasoup state.
- Grace expiry emits `participant-left` and cleans up media resources.
- Explicit `leave-session` cleans up immediately without ending the whole session.

### Observability and Security

- `/health` returns app status, uptime, version, and service readiness.
- `/metrics` exposes Prometheus metrics.
- Metrics include active sessions, connected participants, sent messages, recording errors, and session durations.
- Winston structured logs include configurable log level through `LOG_LEVEL`.
- Helmet, CORS restricted to the frontend origin, and 100 req/min IP rate limiting are enabled.

## Database Schema

See `supabase/schema.sql` for the full schema.

| Table | Purpose |
|---|---|
| `agents` | Agent/admin accounts and role flags |
| `sessions` | Session lifecycle, invite tokens, timing, and agent ownership |
| `participants` | Agent/customer join and leave records |
| `chat_messages` | Text and file chat history |
| `recordings` | Recording status, URL, size, and duration |
| `session_events` | Auditable session event log |

## Supabase Storage

| Bucket | Purpose |
|---|---|
| `recordings` | Uploaded session recordings |
| `chat-files` | Uploaded chat attachments |

## Deployment

- Backend is deployed on Render.
- Frontend origin must be set through `FRONTEND_URL`.
- FFmpeg is required for recording; the Dockerfile includes FFmpeg.
- GitHub Actions includes CI and deployment workflows.

## License

MIT
