import { env } from './env.js';
import { logger } from '../utils/logger.js';

let resolvedAnnouncedIp = env.MEDIASOUP_ANNOUNCED_IP;

/**
 * Detect public IP at startup when running in production with default 127.0.0.1.
 * Without this, cross-device WebRTC connections fail because ICE candidates
 * point to localhost instead of the server's public IP.
 */
export const resolveAnnouncedIp = async () => {
  if (
    env.NODE_ENV === 'production' &&
    (!resolvedAnnouncedIp || resolvedAnnouncedIp === '127.0.0.1')
  ) {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      if (data.ip) {
        resolvedAnnouncedIp = data.ip;
        logger.info({ event: 'public_ip_resolved', ip: resolvedAnnouncedIp });
      }
    } catch (err) {
      logger.warn({
        event: 'public_ip_resolve_failed',
        error: err.message,
        fallback: resolvedAnnouncedIp,
        hint: 'Set MEDIASOUP_ANNOUNCED_IP to your server public IP'
      });
    }
  }
  return resolvedAnnouncedIp;
};

export const getMediasoupConfig = () => ({
  worker: {
    logLevel: 'warn',
    rtcMinPort: env.MEDIASOUP_MIN_PORT,
    rtcMaxPort: env.MEDIASOUP_MAX_PORT
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      }
    ]
  },
  /**
   * WebRtcServer lets us multiplex ALL WebRTC transports through a single port
   * instead of each transport opening its own random port. This is critical
   * for Render.com and similar PaaS platforms that only expose limited ports.
   */
  webRtcServer: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress: resolvedAnnouncedIp,
        port: env.MEDIASOUP_LISTEN_PORT
      },
      {
        protocol: 'tcp',
        ip: '0.0.0.0',
        announcedAddress: resolvedAnnouncedIp,
        port: env.MEDIASOUP_LISTEN_PORT
      }
    ]
  },
  webRtcTransport: {
    // When using webRtcServer, listenIps is NOT needed — the server handles it.
    // These are fallback settings for when webRtcServer is not used.
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: resolvedAnnouncedIp
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferTcp: true,
    initialAvailableOutgoingBitrate: 1_000_000
  }
});

// Legacy export for compatibility — uses resolved IP
export const mediasoupConfig = new Proxy({}, {
  get(_, prop) {
    return getMediasoupConfig()[prop];
  }
});
