import { env } from './env.js';

export const mediasoupConfig = {
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
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: env.MEDIASOUP_ANNOUNCED_IP
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000
  }
};
