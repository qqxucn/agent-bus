// Minimal @types/node declarations for claw-bus compilation
// Node.js 22 has all these as globals; this file satisfies tsc
// When running in OpenClaw (which has @types/node), delete this file.

/// <reference lib="es2022" />

declare var console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

declare var setTimeout: (callback: () => void, ms: number) => number;
declare var clearTimeout: (id: number) => void;
declare var setInterval: (callback: () => void, ms: number) => number;
declare var clearInterval: (id: number) => void;

declare var Buffer: {
  from(data: string, encoding?: string): Buffer;
  from(data: Uint8Array): Buffer;
  alloc(size: number): Buffer;
  isBuffer(obj: unknown): boolean;
};
interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
  length: number;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}

declare var fetch: (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<FetchResponse>;

declare var WebSocket: {
  new(url: string): WebSocket;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
};
interface WebSocket {
  readyState: number;
  onopen: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface EventListener {
  (evt: any): void;
}

declare var MessageEvent: {
  new(type: string, init?: { data?: unknown }): MessageEvent;
};
interface MessageEvent {
  data: unknown;
}

declare var FormData: {
  new(): FormData;
};
interface FormData {
  append(name: string, value: string | Blob, filename?: string): void;
}

declare var Blob: {
  new(parts: unknown[], options?: { type?: string }): Blob;
};
interface Blob {
  size: number;
  type: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Buffer>;
  export function writeFile(path: string, data: string | Buffer): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function access(path: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function stat(path: string): Promise<{ size: number }>;
  export function cp(src: string, dst: string, opts?: { recursive?: boolean }): Promise<void>;
}
