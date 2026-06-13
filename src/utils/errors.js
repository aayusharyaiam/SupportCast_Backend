export class AppError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFoundHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.originalUrl} was not found.`, 404));
};
