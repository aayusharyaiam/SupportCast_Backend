import { AppError } from '../utils/errors.js';

export const validate = (schema) => (req, _res, next) => {
  const parsed = schema.safeParse({
    body: req.body,
    params: req.params,
    query: req.query
  });

  if (!parsed.success) {
    return next(
      new AppError('VALIDATION_ERROR', 'Request validation failed.', 400, parsed.error.flatten())
    );
  }

  req.validated = parsed.data;
  next();
};
