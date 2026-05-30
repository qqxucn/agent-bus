import type { Request, Response, NextFunction } from 'express';
import type { ApiResponse } from '../types/index.js';

/**
 * 请求日志中间件
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[api] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
}

/**
 * CORS 中间件（开发阶段允许所有来源）
 */
export function corsMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * 统一错误处理中间件
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[api] Unhandled error:', err);
  res.status(500).json({
    code: 9000,
    message: 'internal_error',
    data: null,
  } satisfies ApiResponse);
}
