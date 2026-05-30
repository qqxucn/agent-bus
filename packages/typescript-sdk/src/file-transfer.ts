import * as fs from 'node:fs/promises';
import type { BusChannelConfig, SendResult } from './types';
import { AuthManager } from './auth';

type FileMode = 'sandbox' | 'base64' | 'share';

/**
 * 文件传输管理器。
 *
 * 支持三种传输模式，由配置决定，Agent 无感知：
 * - sandbox：通过独立文件沙箱 API 上传/下载，安全隔离
 * - base64：BASE64 内嵌直传，无沙箱时的兜底方案
 * - share：共享目录（内网场景）
 *
 * 自动检测降级：沙箱不可用时降级为 BASE64。
 */
export class FileTransfer {
  private fileMode: FileMode;
  private fileApiUrl: string | undefined;
  private maxFileSizeMb: number;
  private shareDir: string | undefined;

  constructor(
    private readonly config: BusChannelConfig,
    private readonly auth: AuthManager,
  ) {
    this.fileMode = config.fileMode || 'sandbox';
    this.fileApiUrl = config.fileApiUrl;
    this.maxFileSizeMb = config.maxFileSizeMb || 10;
    this.shareDir = config.shareDir;
  }

  // =================================================================
  // 公开 API
  // =================================================================

  /**
   * 上传文件并发送给目标 Agent。
   * sendFile() 在规范中定义，是企业级接口。
   */
  async sendFile(to: string, filePath: string, caption?: string): Promise<SendResult> {
    try {
      await fs.access(filePath);
      const fileName = filePath.split('/').pop() || 'unknown';

      const { fileId, error } = await this.upload(filePath, fileName);
      if (error) {
        return { success: false, error };
      }

      const url = `${this.config.busUrl}/api/messages/send`;
      const headers = this.auth.buildAuthHeaders();

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to,
          type: 'file',
          content: caption || fileName,
          file_id: fileId,
          caption,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { success: false, error: `发送文件消息失败 (${res.status}): ${body}` };
      }

      const data = (await res.json()) as { message_id?: string };
      return { success: true, message_id: data.message_id };
    } catch (e) {
      return { success: false, error: `文件发送失败: ${String(e)}` };
    }
  }

  /**
   * 上传文件到总线。
   */
  async upload(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    const stat = await fs.stat(filePath);
    const fileSizeMb = stat.size / (1024 * 1024);

    const mode = this.detectMode(fileSizeMb);

    switch (mode) {
      case 'sandbox':
        return this.uploadViaSandbox(filePath, fileName);
      case 'base64':
        return this.uploadViaBase64(filePath, fileName);
      case 'share':
        return this.uploadViaShare(filePath, fileName);
    }
  }

  /**
   * 从总线下载文件。
   * 仅沙箱模式支持按 file_id 下载。
   */
  async download(fileId: string): Promise<{ data?: Buffer; error?: string }> {
    const mode = this.fileMode;

    if (mode === 'sandbox' && this.fileApiUrl) {
      return this.downloadViaSandbox(fileId);
    }

    if (mode === 'share') {
      return { error: '共享目录模式不支持按 file_id 下载，请直接访问共享目录' };
    }

    return { error: 'BASE64 直传模式下文件已内嵌在消息中，无需额外下载' };
  }

  // =================================================================
  // 模式选择
  // =================================================================

  /**
   * 检测使用的传输模式。
   * 沙箱不可用时自动降级。
   */
  private detectMode(fileSizeMb: number): FileMode {
    if (fileSizeMb > this.maxFileSizeMb) {
      if (this.shareDir) return 'share';
      if (this.fileApiUrl) return 'sandbox';
      return 'base64';
    }

    if (this.fileMode === 'sandbox' && this.fileApiUrl) return 'sandbox';
    if (this.fileMode === 'share' && this.shareDir) return 'share';

    return 'base64';
  }

  // =================================================================
  // 方式A：沙箱传输
  // =================================================================

  private async uploadViaSandbox(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    if (!this.fileApiUrl) {
      return { error: '沙箱 API 地址未配置' };
    }

    try {
      const fileBuffer = await fs.readFile(filePath);
      const url = `${this.fileApiUrl}/api/files/upload`;
      const headers = this.auth.buildAuthHeaders();

      const formData = new FormData();
      const blob = new Blob([fileBuffer]);
      formData.append('file', blob as unknown as string, fileName);

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: headers.Authorization },
        body: formData as unknown as string,
      });

      if (!res.ok) {
        const body = await res.text();
        return { error: `沙箱上传失败 (${res.status}): ${body}` };
      }

      const data = (await res.json()) as { file_id?: string };
      return { fileId: data.file_id };
    } catch (e) {
      return { error: `沙箱上传异常: ${String(e)}` };
    }
  }

  private async downloadViaSandbox(fileId: string): Promise<{ data?: Buffer; error?: string }> {
    if (!this.fileApiUrl) {
      return { error: '沙箱 API 地址未配置' };
    }

    try {
      const url = `${this.fileApiUrl}/api/files/${fileId}`;
      const headers = this.auth.buildAuthHeaders();

      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: headers.Authorization },
      });

      if (!res.ok) {
        const body = await res.text();
        return { error: `沙箱下载失败 (${res.status}): ${body}` };
      }

      const buffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
      return { data: buffer };
    } catch (e) {
      return { error: `沙箱下载异常: ${String(e)}` };
    }
  }

  // =================================================================
  // 方式B：BASE64 直传
  // =================================================================

  private async uploadViaBase64(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const base64Content = fileBuffer.toString('base64');

      const url = `${this.config.busUrl}/api/files/upload`;
      const headers = this.auth.buildAuthHeaders();

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          file_name: fileName,
          content: base64Content,
          encoding: 'base64',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { error: `BASE64 上传失败 (${res.status}): ${body}` };
      }

      const data = (await res.json()) as { file_id?: string };
      return { fileId: data.file_id };
    } catch (e) {
      return { error: `BASE64 上传异常: ${String(e)}` };
    }
  }

  // =================================================================
  // 方式C：共享目录
  // =================================================================

  private async uploadViaShare(filePath: string, fileName: string): Promise<{ fileId?: string; error?: string }> {
    if (!this.shareDir) {
      return { error: '共享目录未配置' };
    }

    try {
      const destPath = `${this.shareDir}/${fileName}`;
      await fs.cp(filePath, destPath);
      return { fileId: `share://${fileName}` };
    } catch (e) {
      return { error: `共享目录复制失败: ${String(e)}` };
    }
  }
}
