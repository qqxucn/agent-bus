import { describe, it, expect } from 'vitest';
import {
  BusAuthError,
  BusConnectionError,
  BusFileError,
  BusChannelConfig,
} from '../src/types';
import { isSupportedFileType, getFileExtension } from '../src/utils';

// =============================================================================
// 错误类型测试
// =============================================================================

describe('BusAuthError', () => {
  it('应正确实例化', () => {
    const err = new BusAuthError('注册失败');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BusAuthError);
    expect(err.name).toBe('BusAuthError');
    expect(err.message).toBe('注册失败');
  });
});

describe('BusConnectionError', () => {
  it('应正确实例化', () => {
    const err = new BusConnectionError('连接超时');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BusConnectionError);
    expect(err.name).toBe('BusConnectionError');
    expect(err.message).toBe('连接超时');
  });
});

describe('BusFileError', () => {
  it('应正确实例化', () => {
    const err = new BusFileError('文件过大');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BusFileError);
    expect(err.name).toBe('BusFileError');
    expect(err.message).toBe('文件过大');
  });
});

// =============================================================================
// 文件工具方法测试
// =============================================================================

describe('getFileExtension', () => {
  it('pdf 文件应返回 pdf', () => {
    expect(getFileExtension('report.pdf')).toBe('pdf');
  });

  it('JPG 大写应转为小写', () => {
    expect(getFileExtension('image.JPG')).toBe('jpg');
  });

  it('无扩展名应返回空字符串', () => {
    expect(getFileExtension('no_ext')).toBe('');
  });

  it('点开头的文件应返回空字符串', () => {
    expect(getFileExtension('.gitignore')).toBe('gitignore');
  });

  it('多级后缀只取最后一级', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('带路径的文件应正确提取', () => {
    expect(getFileExtension('/home/user/doc.pdf')).toBe('pdf');
    expect(getFileExtension('C:\\Users\\test\\file.txt')).toBe('txt');
  });
});

describe('isSupportedFileType', () => {
  it('常见代码文件应被支持', () => {
    expect(isSupportedFileType('script.py')).toBe(true);
    expect(isSupportedFileType('app.ts')).toBe(true);
    expect(isSupportedFileType('main.js')).toBe(true);
  });

  it('常见文档文件应被支持', () => {
    expect(isSupportedFileType('report.pdf')).toBe(true);
    expect(isSupportedFileType('readme.md')).toBe(true);
    expect(isSupportedFileType('data.json')).toBe(true);
  });

  it('常见图片文件应被支持', () => {
    expect(isSupportedFileType('photo.jpg')).toBe(true);
    expect(isSupportedFileType('photo.png')).toBe(true);
    expect(isSupportedFileType('icon.svg')).toBe(true);
  });

  it('不支持的文件类型应返回 false', () => {
    expect(isSupportedFileType('setup.exe')).toBe(false);
    expect(isSupportedFileType('lib.dll')).toBe(false);
    expect(isSupportedFileType('font.ttf')).toBe(false);
  });

  it('无扩展名应返回 false', () => {
    expect(isSupportedFileType('Makefile')).toBe(false);
  });
});

// =============================================================================
// SendResult 类型验证
// =============================================================================

describe('SendResult 类型', () => {
  it('成功结果应包含 message_id', () => {
    const result: { success: true; message_id?: string; error?: never } = {
      success: true,
      message_id: 'msg_001',
    };
    expect(result.success).toBe(true);
    expect(result.message_id).toBe('msg_001');
  });

  it('失败结果应包含 error', () => {
    const result = { success: false, error: '连接超时' };
    expect(result.success).toBe(false);
    expect(result.error).toBe('连接超时');
  });
});

// =============================================================================
// BusChannelConfig 默认值验证
// =============================================================================

describe('BusChannelConfig skipRegistrationIfTokenSet', () => {
  it('未传时应为 undefined（由上游默认处理）', () => {
    const config: BusChannelConfig = {
      mode: 'poll',
      busUrl: 'http://localhost:4322',
      agentId: 'test-agent',
      agentToken: 'test-token',
    };
    expect(config.skipRegistrationIfTokenSet).toBeUndefined();
  });

  it('显式设为 false 应保留', () => {
    const config: BusChannelConfig = {
      mode: 'poll',
      busUrl: 'http://localhost:4322',
      agentId: 'test-agent',
      agentToken: 'test-token',
      skipRegistrationIfTokenSet: false,
    };
    expect(config.skipRegistrationIfTokenSet).toBe(false);
  });
});
