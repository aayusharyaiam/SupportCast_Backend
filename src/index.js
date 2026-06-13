import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { initSocketServer } from './socket.js';
import { initMediasoup } from './services/mediasoup.service.js';
import { logger } from './utils/logger.js';

const app = createApp();
const server = http.createServer(app);

await initMediasoup();
initSocketServer(server);

server.listen(env.PORT, () => {
  logger.info({
    event: 'server_started',
    port: env.PORT,
    env: env.NODE_ENV,
    version: process.env.npm_package_version
  });
});

const shutdown = async (signal) => {
  logger.info({ event: 'shutdown_started', signal });
  server.close(() => {
    logger.info({ event: 'shutdown_complete' });
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
