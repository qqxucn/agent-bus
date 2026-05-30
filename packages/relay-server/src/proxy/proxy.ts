// ========================================================
// Agent 消息总线 — 中继层 REST 代理核心
// 将 HTTP 请求转发到目标总线服务，返回响应
// ========================================================

import http from 'node:http';
import https from 'node:https';
import type { RelayConfig } from '../config.js';
import type { ProxyResult } from '../types.js';

const DEFAULT_TIMEOUT = 30000;

/**
 * 判断目标地址是否使用 HTTPS
 */
function isHttpsTarget(host: string, port: number, path: string): boolean {
  // 如果有 https:// 前缀，或者是 443 端口，则是 HTTPS
  if (path.startsWith('https://') || port === 443) return true;
  return false;
}

/**
 * REST 代理 — 将一个 HTTP 请求转发到总线目标地址
 *
 * 方案A（Simple HTTP Proxy）：
 *   直接用 http.request 转发到 busHost:busPort
 *   适用于中继服务端能直接访问总线的场景（同网络/公网可达）
 *
 * @param config 中继配置
 * @param method HTTP 方法
 * @param path  请求路径（如 '/api/messages/send'）
 * @param headers 原始请求头（会透传，仅清除 host）
 * @param body  请求体字符串
 */
export async function proxyRequest(
  config: RelayConfig,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<ProxyResult> {
  return proxyHttp(config, method, path, headers, body);
}

/**
 * 通过 HTTP.request 直接转发（方案A）
 */
function proxyHttp(
  config: RelayConfig,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<ProxyResult> {
  return new Promise((resolve, reject) => {
    // 清除 host 头防止冲突（总线用自己的 host）
    const cleanHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'x-relay-token') {
        cleanHeaders[key] = value;
      }
      // 保留 Authorization 头透传
    }

    const isHttps = isHttpsTarget(config.busHost, config.busPort, path);
    const httpModule = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: config.busHost,
      port: config.busPort,
      path,
      method,
      headers: cleanHeaders,
      timeout: DEFAULT_TIMEOUT,
    };

    const req = httpModule.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const resultBody = Buffer.concat(chunks).toString('utf-8');
        resolve({
          status: res.statusCode ?? 502,
          headers: res.headers as Record<string, string>,
          body: resultBody,
        });
      });
    });

    req.on('error', (err: Error) => {
      reject(new Error(`proxy_connection_error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('proxy_timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}

export { proxyHttp };
