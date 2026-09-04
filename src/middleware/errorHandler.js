/**
 * Global error handler middleware.
 */

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'An unexpected error occurred.';

  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ULNet Error] ${status} ${req.method} ${req.path}:`, err);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
}
