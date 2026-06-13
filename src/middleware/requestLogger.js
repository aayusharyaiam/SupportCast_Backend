import { logger } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    logger.info({
      event: 'http_request',
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
};
