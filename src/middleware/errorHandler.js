import { logger } from '../utils/logger.js';

export const errorHandler = (err, req, res, _next) => {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status >= 500 ? 'Something went wrong. Please try again.' : err.message;

  logger.error({
    event: 'request_failed',
    code,
    status,
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: err.stack
  });

  res.status(status).json({
    success: false,
    data: null,
    error: {
      code,
      message,
      details: err.details
    },
    timestamp: new Date().toISOString()
  });
};
