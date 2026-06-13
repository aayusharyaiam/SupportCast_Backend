import * as mediasoup from 'mediasoup';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { mediasoupConfig } from '../config/mediasoup.js';
import { metrics } from './metrics.service.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

let worker;
const rooms = new Map();

export const initMediasoup = async () => {
  worker = await mediasoup.createWorker(mediasoupConfig.worker);

  worker.on('died', () => {
    logger.error({ event: 'mediasoup_worker_died' });
    setTimeout(() => process.exit(1), 2000);
  });

  logger.info({ event: 'mediasoup_worker_ready' });
  return worker;
};

const isReady = () => Boolean(worker);

const getOrCreateRoom = async (sessionId) => {
  if (!worker) {
    throw new AppError('MEDIASOUP_NOT_READY', 'Media server is still starting.', 503);
  }

  const existing = rooms.get(sessionId);
  if (existing) {
    return existing;
  }

  const router = await worker.createRouter(mediasoupConfig.router);
  const room = {
    sessionId,
    router,
    peers: new Map(),
    plainTransports: new Map()
  };

  rooms.set(sessionId, room);
  metrics.activeSessions.set(rooms.size);
  return room;
};

const addPeer = async ({ sessionId, socketId, participantId, role, displayName }) => {
  const room = await getOrCreateRoom(sessionId);
  room.peers.set(socketId, {
    participantId,
    role,
    displayName,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map()
  });

  metrics.connectedParticipants.inc();
  return room;
};

const getPeer = (sessionId, socketId) => {
  const room = rooms.get(sessionId);
  const peer = room?.peers.get(socketId);
  if (!room || !peer) {
    throw new AppError('PEER_NOT_FOUND', 'Participant is not connected to this media room.', 404);
  }

  return { room, peer };
};

const getRtpCapabilities = async (sessionId) => {
  const room = await getOrCreateRoom(sessionId);
  return room.router.rtpCapabilities;
};

const createWebRtcTransport = async ({ sessionId, socketId, direction }) => {
  const { room, peer } = getPeer(sessionId, socketId);
  const transport = await room.router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

  transport.appData = { direction };
  peer.transports.set(transport.id, transport);

  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') {
      transport.close();
    }
  });

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  };
};

const connectTransport = async ({ sessionId, socketId, transportId, dtlsParameters }) => {
  const { peer } = getPeer(sessionId, socketId);
  const transport = peer.transports.get(transportId);
  if (!transport) {
    throw new AppError('TRANSPORT_NOT_FOUND', 'Media transport was not found.', 404);
  }

  await transport.connect({ dtlsParameters });
};

const produce = async ({ sessionId, socketId, transportId, kind, rtpParameters }) => {
  const { peer } = getPeer(sessionId, socketId);
  const transport = peer.transports.get(transportId);
  if (!transport) {
    throw new AppError('TRANSPORT_NOT_FOUND', 'Media transport was not found.', 404);
  }

  const producer = await transport.produce({ kind, rtpParameters });
  peer.producers.set(producer.id, producer);

  producer.on('transportclose', () => {
    peer.producers.delete(producer.id);
  });

  return {
    producerId: producer.id,
    participantId: peer.participantId,
    kind
  };
};

const consume = async ({ sessionId, socketId, producerId, rtpCapabilities }) => {
  const { room, peer } = getPeer(sessionId, socketId);

  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new AppError('CANNOT_CONSUME', 'Client cannot consume this producer.', 422);
  }

  const recvTransport = [...peer.transports.values()].find(
    (transport) => transport.appData.direction === 'recv'
  );

  if (!recvTransport) {
    throw new AppError('RECV_TRANSPORT_REQUIRED', 'Create a receive transport first.', 409);
  }

  const consumer = await recvTransport.consume({
    producerId,
    rtpCapabilities,
    paused: true
  });

  peer.consumers.set(consumer.id, consumer);

  consumer.on('transportclose', () => {
    peer.consumers.delete(consumer.id);
  });

  return {
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters
  };
};

const resumeConsumer = async ({ sessionId, socketId, consumerId }) => {
  const { peer } = getPeer(sessionId, socketId);
  const consumer = peer.consumers.get(consumerId);
  if (!consumer) {
    throw new AppError('CONSUMER_NOT_FOUND', 'Media consumer was not found.', 404);
  }

  await consumer.resume();
};

const createPlainTransport = async (sessionId) => {
  const room = rooms.get(sessionId);
  if (!room) {
    throw new AppError('ROOM_NOT_FOUND', 'Session room not found.', 404);
  }

  const plainTransport = await room.router.createPlainTransport({
    listenIp: { ip: '0.0.0.0', announcedIp: mediasoupConfig.webRtcTransport.listenIps[0].announcedIp },
    enableRtp: true,
    enableTcp: false,
    preferUdp: true
  });

  room.plainTransports.set(plainTransport.id, plainTransport);

  return {
    id: plainTransport.id,
    ip: plainTransport.tuple.localIp,
    port: plainTransport.tuple.localPort
  };
};

const pipeProducersToPlainTransport = async (sessionId, plainTransportId, io) => {
  const room = rooms.get(sessionId);
  if (!room) return;

  const plainTransport = room.plainTransports.get(plainTransportId);
  if (!plainTransport) return;

  for (const [, peer] of room.peers) {
    for (const [, producer] of peer.producers) {
      try {
        await producer.pipeToPlainTransport(plainTransport);
      } catch (err) {
        logger.error({ event: 'pipe_producer_failed', producerId: producer.id, error: err.message });
      }
    }
  }
};

const getPlainTransport = (sessionId, plainTransportId) => {
  const room = rooms.get(sessionId);
  if (!room) return null;
  return room.plainTransports.get(plainTransportId) || null;
};

const cleanupPeer = (sessionId, socketId) => {
  const room = rooms.get(sessionId);
  const peer = room?.peers.get(socketId);
  if (!room || !peer) {
    return;
  }

  for (const consumer of peer.consumers.values()) consumer.close();
  for (const producer of peer.producers.values()) producer.close();
  for (const transport of peer.transports.values()) transport.close();

  room.peers.delete(socketId);
  metrics.connectedParticipants.dec();

  if (room.peers.size === 0) {
    for (const [, transport] of room.plainTransports) {
      transport.close();
    }
    room.plainTransports.clear();
    room.router.close();
    rooms.delete(sessionId);
    metrics.activeSessions.set(rooms.size);
  }
};

const getOtherProducers = (sessionId, socketId) => {
  const room = rooms.get(sessionId);
  if (!room) {
    return [];
  }

  return [...room.peers.entries()].flatMap(([peerSocketId, peer]) => {
    if (peerSocketId === socketId) {
      return [];
    }

    return [...peer.producers.values()].map((producer) => ({
      producerId: producer.id,
      participantId: peer.participantId,
      kind: producer.kind
    }));
  });
};

export const mediasoupService = {
  initMediasoup,
  isReady,
  getOrCreateRoom,
  addPeer,
  getRtpCapabilities,
  createWebRtcTransport,
  connectTransport,
  produce,
  consume,
  resumeConsumer,
  createPlainTransport,
  pipeProducersToPlainTransport,
  getPlainTransport,
  cleanupPeer,
  getOtherProducers,
  rooms,
};