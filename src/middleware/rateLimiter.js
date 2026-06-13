import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again.'
    },
    timestamp: new Date().toISOString()
  }
});
