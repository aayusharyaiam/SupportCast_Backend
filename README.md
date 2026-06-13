# SupportCast Backend

Real-time video support platform backend — Node.js 20 + Express 5 + Socket.io 4 + mediasoup 3 (SFU).

## Tech Stack

| Layer | Technology |
|------|------------|
| Runtime | Node.js 20+ |
| HTTP Server | Express 5 |
| WebSocket | Socket.io 4 |
| Media Server | mediasoup 3 (SFU) |
| Database | Supabase (PostgreSQL 15) |
| Auth | Supabase Auth → JWT |
| File Storage | Supabase Storage |
| Logging | Winston |
| Metrics | prom-client |
| Validation | Zod |

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase project
- FFmpeg (for recording, optional in dev — required in production)

### Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

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

### Installation

```bash
npm install
```

### Running

```bash
# Development
npm run dev

# Production
npm start

# Lint
npm run lint

# Test (passWithNoTests)
npm test
```

## API Endpoints

### Auth
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v1/auth/login` | Agent login | None |
| POST | `/api/v1/auth/logout` | Agent logout | Agent |

### Sessions
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v1/sessions` | Create session | Agent/Admin |
| GET | `/api/v1/sessions` | List agent's sessions | Agent/Admin |
| GET | `/api/v1/sessions/:id` | Get session details | Agent/Admin/Customer |
| DELETE | `/api/v1/sessions/:id` | End session | Agent/Admin |
| POST | `/api/v1/sessions/join` | Join via invite token | None |
| GET | `/api/v1/sessions/:id/chat` | Get chat history | Agent/Admin/Customer |
| GET | `/api/v1/sessions/:id/recording` | Get recording status | Agent/Admin |
| POST | `/api/v1/sessions/:id/files/signed-url` | Get signed upload URL | Agent/Admin/Customer |

### Admin
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/admin/sessions/live` | All active sessions | Admin |
| GET | `/api/v1/admin/sessions/history` | Paginated history (date_from, date_to, search, page, limit) | Admin |
| DELETE | `/api/v1/admin/sessions/:id` | Force-end session | Admin |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (status, uptime, version, service checks) |
| GET | `/metrics` | Prometheus-compatible metrics |

## Socket.io Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join-session` | `{ sessionId, token, name }` | Join/reconnect to session |
| `get-rtp-capabilities` | `{ sessionId }` | Get mediasoup router capabilities |
| `create-transport` | `{ sessionId, direction }` | Create send or recv WebRTC transport |
| `connect-transport` | `{ sessionId, transportId, dtlsParameters }` | Connect transport (DTLS) |
| `produce` | `{ sessionId, transportId, kind, rtpParameters }` | Produce audio/video |
| `consume` | `{ sessionId, producerId, rtpCapabilities }` | Consume from a producer |
| `resume-consumer` | `{ sessionId, consumerId }` | Resume paused consumer |
| `send-chat` | `{ sessionId, message }` | Send text message |
| `share-file` | `{ sessionId, fileName, fileUrl, fileSize, fileType }` | Share a file message |
| `mute-audio` | `{ sessionId, muted }` | Toggle audio mute |
| `toggle-video` | `{ sessionId, enabled }` | Toggle video |
| `start-recording` | `{ sessionId }` | Start recording (agent only) |
| `stop-recording` | `{ sessionId }` | Stop recording (agent only) |
| `end-session` | `{ sessionId }` | End session |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `participant-joined` | `{ participantId, name, role }` | New participant joined |
| `participant-left` | `{ participantId }` | Participant left (or grace expired) |
| `new-producer` | `{ producerId, participantId, kind }` | New audio/video stream available |
| `chat-message` | `ChatMessage` | Chat or file message received |
| `recording-status` | `{ status, recordingId?, fileUrl? }` | Recording state change |
| `participant-audio-muted` | `{ participantId, muted }` | Participant muted |
| `participant-video-toggled` | `{ participantId, enabled }` | Participant video toggle |
| `session-ended` | `{ sessionId, endedBy }` | Session terminated |

## Recording Architecture

Recording uses mediasoup PlainTransport to pipe RTP streams to FFmpeg:

1. `createPlainTransport` creates a UDP PlainTransport on the router
2. `pipeProducersToPlainTransport` creates consumers for all active producers
3. FFmpeg subscribes to the UDP port, encodes to MP4
4. On stop, the MP4 file is uploaded to Supabase Storage
5. Recording metadata is saved to the `recordings` table

**Note:** FFmpeg must be installed on the production server. Install with `apt install ffmpeg`.

## Reconnect Handling

When a participant disconnects unexpectedly:

1. Server starts a 30-second timer for that participant
2. `participant-left` is NOT emitted during the grace window
3. If the participant reconnects within 30s, `join-session` clears the timer
4. If the timer expires, `participant-left` is emitted and mediasoup state is cleaned up

## Database Schema

See `supabase/schema.sql` for full schema:

- `agents` — Agent accounts (id, email, display_name, role, supabase_user_id)
- `sessions` — Support sessions (id, agent_id, status, invite_token, started_at, ended_at)
- `participants` — Session participants (session_id, role, display_name, joined_at, left_at)
- `chat_messages` — Chat history (session_id, sender_role, sender_name, type, content, file_url, file_name, file_size)
- `recordings` — Recording metadata (session_id, status, file_url, file_size, duration_seconds)
- `session_events` — Event log (session_id, event_type, actor_role, actor_name, metadata)

## Architecture

```
┌─────────────────┐     HTTPS/WSS      ┌──────────────────┐
│  React Client   │◄──────────────────►│  Express Server │
│  (Browser)      │                    │                  │
└────────┬────────┘                    │  ┌────────────┐  │
         │                             │  │  Socket.io │  │
         │                             │  │  Signaling │  │
         │                             │  └─────┬──────┘  │
         │                             │        │         │
         │                             │  ┌─────▼──────┐  │
         │                             │  │  mediasoup │  │
         │                             │  │   (SFU)    │  │
         │                             │  └─────┬──────┘  │
         │                             │        │         │
         │                             │  ┌─────▼──────┐  │
         │                             │  │ Supabase   │  │
         │                             │  │ PostgreSQL │  │
         │                             │  └────────────┘  │
         └─────────────────────────────┘
```

## License

MIT