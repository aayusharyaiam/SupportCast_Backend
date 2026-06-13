import { Server } from 'socket.io';
import { env } from './config/env.js';
import { verifySocketToken } from './middleware/authenticate.js';
import { chatService } from './services/chat.service.js';
import { mediasoupService } from './services/mediasoup.service.js';
import { recordingService } from './services/recording.service.js';
import { sessionService } from './services/session.service.js';
import { AppError } from './utils/errors.js';
import { logger } from './utils/logger.js';

let ioServer = null;
const disconnectTimers = new Map();

export const initSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true
    }
  });
  ioServer = io;

  io.use(async (socket, next) => {
    try {
      const user = await verifySocketToken(socket.handshake.auth?.token);
      socket.user = user;
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on('connection', (socket) => {
    logger.info({ event: 'socket_connected', socketId: socket.id, userId: socket.user.id });

    socket.on('join-session', handleSocketEvent(socket, async (payload, ack) => {
      const { sessionId, name } = payload;
      authorizeSession(socket, sessionId);

      const timerKey = `${sessionId}:${socket.user.id}`;
      const existingTimer = disconnectTimers.get(timerKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        disconnectTimers.delete(timerKey);
        const existingPeer = mediasoupService.getPeerInfo(sessionId, socket.id);
        if (existingPeer) {
          const existingProducers = mediasoupService.getOtherProducers(sessionId, socket.id);
          const existingParticipants = mediasoupService.getOtherPeers(sessionId, socket.id);
          ack?.({
            ok: true,
            data: {
              sessionId,
              role: socket.user.role,
              participantId: existingPeer.participantId,
              producers: existingProducers,
              participants: existingParticipants,
              reconnected: true
            }
          });
          return;
        }
      }

      let participantId = socket.user.id;
      let displayName = name || socket.user.displayName || socket.user.email || socket.user.role;

      if (socket.user.type === 'agent') {
        const session = await sessionService.getById(sessionId);
        await sessionService.logEvent({
          sessionId,
          eventType: 'participant_joined',
          actorRole: 'agent',
          actorName: displayName
        });
        participantId = session.agent_id;
      }

      await mediasoupService.addPeer({
        sessionId,
        socketId: socket.id,
        participantId,
        role: socket.user.role,
        displayName
      });

      socket.data.sessionId = sessionId;
      socket.data.participantId = participantId;
      socket.join(sessionId);

      socket.to(sessionId).emit('participant-joined', {
        participantId,
        name: displayName,
        role: socket.user.role
      });

      const existingProducers = mediasoupService.getOtherProducers(sessionId, socket.id);
      const existingParticipants = mediasoupService.getOtherPeers(sessionId, socket.id);

      ack?.({
        ok: true,
        data: {
          sessionId,
          role: socket.user.role,
          participantId,
          producers: existingProducers,
          participants: existingParticipants
        }
      });
    }));

    socket.on('get-ice-servers', handleSocketEvent(socket, async (_payload, ack) => {
      const iceServers = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
      ];

      // Add TURN servers if configured
      if (env.TURN_URLS) {
        const turnUrls = env.TURN_URLS.split(',').map(u => u.trim()).filter(Boolean);
        if (turnUrls.length > 0) {
          iceServers.push({
            urls: turnUrls,
            username: env.TURN_USERNAME,
            credential: env.TURN_CREDENTIAL
          });
        }
      }

      ack?.({ ok: true, data: iceServers });
    }));

    socket.on('get-rtp-capabilities', handleSocketEvent(socket, async ({ sessionId }, ack) => {
      authorizeSession(socket, sessionId);
      const rtpCapabilities = await mediasoupService.getRtpCapabilities(sessionId);
      ack?.({ ok: true, data: rtpCapabilities });
    }));

    socket.on('create-transport', handleSocketEvent(socket, async ({ sessionId, direction }, ack) => {
      authorizeSession(socket, sessionId);
      const transport = await mediasoupService.createWebRtcTransport({
        sessionId,
        socketId: socket.id,
        direction
      });
      ack?.({ ok: true, data: transport });
    }));

    socket.on(
      'connect-transport',
      handleSocketEvent(socket, async ({ sessionId, transportId, dtlsParameters }, ack) => {
        authorizeSession(socket, sessionId);
        await mediasoupService.connectTransport({
          sessionId,
          socketId: socket.id,
          transportId,
          dtlsParameters
        });
        ack?.({ ok: true });
      })
    );

    socket.on(
      'produce',
      handleSocketEvent(socket, async ({ sessionId, transportId, kind, rtpParameters }, ack) => {
        authorizeSession(socket, sessionId);
        const producer = await mediasoupService.produce({
          sessionId,
          socketId: socket.id,
          transportId,
          kind,
          rtpParameters
        });
        socket.to(sessionId).emit('new-producer', producer);
        ack?.({ ok: true, data: producer });
      })
    );

    socket.on(
      'consume',
      handleSocketEvent(socket, async ({ sessionId, producerId, rtpCapabilities }, ack) => {
        authorizeSession(socket, sessionId);
        const consumer = await mediasoupService.consume({
          sessionId,
          socketId: socket.id,
          producerId,
          rtpCapabilities
        });
        ack?.({ ok: true, data: consumer });
      })
    );

    socket.on('resume-consumer', handleSocketEvent(socket, async ({ sessionId, consumerId }, ack) => {
      authorizeSession(socket, sessionId);
      await mediasoupService.resumeConsumer({ sessionId, socketId: socket.id, consumerId });
      ack?.({ ok: true });
    }));

    socket.on('send-chat', handleSocketEvent(socket, async ({ sessionId, message }, ack) => {
      authorizeSession(socket, sessionId);
      if (!message?.trim()) {
        throw new AppError('EMPTY_MESSAGE', 'Message cannot be empty.', 400);
      }
      if (message.length > 2000) {
        throw new AppError('MSG_TOO_LONG', 'Message must be 2000 characters or fewer.', 400);
      }

      const dbSenderRole = socket.user.role === 'admin' ? 'agent' : socket.user.role;

      const saved = await chatService.saveMessage({
        sessionId,
        senderRole: dbSenderRole,
        senderName: socket.user.displayName || socket.user.email || socket.user.role,
        content: message.trim()
      });

      io.to(sessionId).emit('chat-message', saved);
      ack?.({ ok: true, data: saved });
    }));

    socket.on('share-file', handleSocketEvent(socket, async ({ sessionId, fileName, fileUrl, fileSize, fileType }, ack) => {
      authorizeSession(socket, sessionId);
      if (!fileName || !fileUrl) {
        throw new AppError('INVALID_FILE', 'File name and URL are required.', 400);
      }

      const dbSenderRole = socket.user.role === 'admin' ? 'agent' : socket.user.role;

      const saved = await chatService.saveFileMessage({
        sessionId,
        senderRole: dbSenderRole,
        senderName: socket.user.displayName || socket.user.email || socket.user.role,
        fileName,
        fileUrl,
        fileSize: fileSize || 0
      });

      io.to(sessionId).emit('chat-message', saved);
      ack?.({ ok: true, data: saved });
    }));

    socket.on('mute-audio', handleSocketEvent(socket, async ({ sessionId, muted }, ack) => {
      authorizeSession(socket, sessionId);
      socket.to(sessionId).emit('participant-audio-muted', {
        participantId: socket.data.participantId,
        muted: Boolean(muted)
      });
      ack?.({ ok: true });
    }));

    socket.on('toggle-video', handleSocketEvent(socket, async ({ sessionId, enabled }, ack) => {
      authorizeSession(socket, sessionId);
      socket.to(sessionId).emit('participant-video-toggled', {
        participantId: socket.data.participantId,
        enabled: Boolean(enabled)
      });
      ack?.({ ok: true });
    }));

    socket.on('start-recording', handleSocketEvent(socket, async ({ sessionId }, ack) => {
      authorizeAgent(socket);
      authorizeSession(socket, sessionId);
      const recording = await recordingService.startRecording(sessionId);
      io.to(sessionId).emit('recording-status', {
        sessionId,
        status: recording.status,
        recordingId: recording.id
      });
      ack?.({ ok: true, data: recording });
    }));

    socket.on('stop-recording', handleSocketEvent(socket, async ({ sessionId }, ack) => {
      authorizeAgent(socket);
      authorizeSession(socket, sessionId);
      io.to(sessionId).emit('recording-status', {
        sessionId,
        status: 'processing'
      });
      const recording = await recordingService.stopRecording(sessionId);
      io.to(sessionId).emit('recording-status', {
        sessionId,
        status: recording.status,
        recordingId: recording.id,
        fileUrl: recording.file_url
      });
      ack?.({ ok: true, data: recording });
    }));

    socket.on('end-session', handleSocketEvent(socket, async ({ sessionId }, ack) => {
      authorizeAgent(socket);
      authorizeSession(socket, sessionId);
      await sessionService.endSession({ sessionId, endedBy: socket.user.role });
      io.to(sessionId).emit('session-ended', { sessionId, endedBy: socket.user.role });
      ack?.({ ok: true });
    }));

    socket.on('disconnect', () => {
      const sessionId = socket.data.sessionId;
      const participantId = socket.data.participantId;

      if (sessionId && participantId) {
        const timerKey = `${sessionId}:${participantId}`;
        const timer = setTimeout(() => {
          mediasoupService.cleanupPeer(sessionId, socket.id);
          io.to(sessionId).emit('participant-left', { participantId });
          disconnectTimers.delete(timerKey);
          logger.info({ event: 'participant_grace_expired', sessionId, participantId });
        }, 30000);

        disconnectTimers.set(timerKey, timer);
        logger.info({ event: 'socket_disconnected_grace_start', socketId: socket.id, sessionId, participantId });
      } else {
        logger.info({ event: 'socket_disconnected', socketId: socket.id });
      }
    });
  });

  return io;
};

export const getSocketServer = () => ioServer;

const handleSocketEvent = (socket, handler) => async (payload, ack) => {
  try {
    await handler(payload || {}, ack);
  } catch (error) {
    const response = {
      code: error.code || 'SOCKET_ERROR',
      message: error.message || 'Socket event failed.'
    };
    socket.emit('error', response);
    ack?.({ ok: false, error: response });
  }
};

const authorizeSession = (socket, sessionId) => {
  if (!sessionId) {
    throw new AppError('SESSION_REQUIRED', 'Session id is required.', 400);
  }

  if (socket.user.type === 'customer' && socket.user.sessionId !== sessionId) {
    throw new AppError('FORBIDDEN', 'You are not allowed to access this session.', 403);
  }
};

const authorizeAgent = (socket) => {
  if (socket.user.type !== 'agent') {
    throw new AppError('FORBIDDEN', 'Only agents can perform this action.', 403);
  }
};
