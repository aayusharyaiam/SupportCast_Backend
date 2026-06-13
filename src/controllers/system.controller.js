import { metricsService } from '../services/metrics.service.js';
import { mediasoupService } from '../services/mediasoup.service.js';
import { successResponse } from '../utils/response.js';

const health = async (_req, res) => {
  successResponse(res, {
    status: 'ok',
    version: process.env.npm_package_version,
    uptime: process.uptime(),
    services: {
      mediasoup: mediasoupService.isReady() ? 'ready' : 'initializing'
    }
  });
};

const metrics = async (_req, res) => {
  res.set('Content-Type', metricsService.contentType());
  res.send(await metricsService.render());
};

export const systemController = {
  health,
  metrics
};
