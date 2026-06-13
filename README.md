# SupportCast Backend

Real-time video support platform backend — Node.js + Express + Socket.io + mediasoup SFU.

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
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |

## API Endpoints

### Auth
- `POST /api/v1/auth/login` — Agent login
- `POST /api/v1/auth/logout` — Agent logout

### Sessions
- `POST /api/v1/sessions` — Create session (agent only)
- `GET /api/v1/sessions` — List agent's sessions
- `GET /api/v1/sessions/:id` — Get session details
- `DELETE /api/v1/sessions/:id` — End session
- `POST /api/v1/sessions/join` — Join via invite token (customer)
- `GET /api/v1/sessions/:id/chat` — Get chat history
- `GET /api/v1/sessions/:id/recording` — Get recording status

### Admin
- `GET /api/v1/admin/sessions/live` — All active sessions (admin only)
- `GET /api/v1/admin/sessions/history` — Paginated session history
- `DELETE /api/v1/admin/sessions/:id` — Force-end session

### System
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics

## Socket.io Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `join-session` | `{ sessionId, token, name }` | Join session |
| `get-rtp-capabilities` | `{ sessionId }` | Get router RTP capabilities |
| `create-transport` | `{ sessionId, direction }` | Create send/recv transport |
| `connect-transport` | `{ sessionId, transportId, dtlsParameters }` | Connect transport |
| `produce` | `{ sessionId, transportId, kind, rtpParameters }` | Produce media |
| `consume` | `{ sessionId, producerId, rtpCapabilities }` | Consume media |
| `send-chat` | `{ sessionId, message }` | Send chat message |
| `mute-audio` | `{ sessionId, muted }` | Toggle audio mute |
| `toggle-video` | `{ sessionId, enabled }` | Toggle video |
| `start-recording` | `{ sessionId }` | Start recording (agent) |
| `stop-recording` | `{ sessionId }` | Stop recording (agent) |
| `end-session` | `{ sessionId }` | End session |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `session-joined` | `{ sessionId, role, participantId, producers }` | Join confirmed |
| `participant-joined` | `{ participantId, name, role }` | New participant |
| `participant-left` | `{ participantId }` | Participant left |
| `new-producer` | `{ producerId, participantId, kind }` | New media stream |
| `chat-message` | `{ id, sender_role, sender_name, content, created_at }` | Chat message |
| `recording-status` | `{ status }` | Recording state change |
| `session-ended` | `{ sessionId, endedBy }` | Session terminated |

## Database Schema

See `supabase/schema.sql` for full schema:

- `agents` — Agent accounts
- `sessions` — Support sessions
- `participants` — Session participants
- `chat_messages` — Chat history
- `recordings` — Recording metadata
- `session_events` — Event log

## Architecture

```
┌─────────────────┐     HTTPS/WSS      ┌──────────────────┐
│  React Client   │◄──────────────────►│  Express Server │
│  (Browser)      │                    │                  │
└────────┬────────┘                    │  ┌────────────┐  │
         │                             │  │   Socket.io │  │
         │                             │  │  (Signaling)│  │
         │                             │  └─────┬──────┘  │
         │                             │        │         │
         │                             │  ┌─────▼──────┐  │
         │                             │  │  mediasoup │  │
         │                             │  │  (SFU)     │  │
         │                             │  └─────▲──────┘  │
         │                             │        │         │
         │                             │  ┌─────┴──────┐  │
         │                             │  │ Supabase    │  │
         │                             │  │ PostgreSQL  │  │
         │                             │  └────────────┘  │
         └─────────────────────────────┘
```

## License

MIT