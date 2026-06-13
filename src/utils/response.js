export const successResponse = (res, data, status = 200, extra = {}) => {
  res.status(status).json({
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
    ...extra
  });
};

export const emptyResponse = (res) => {
  res.status(204).send();
};
