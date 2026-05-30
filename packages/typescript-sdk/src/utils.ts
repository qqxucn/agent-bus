// ===== claw-bus — 文件工具方法 =====
// 与 Python 版对齐：扩展名统一使用无点小写格式，如 "pdf" 而非 ".pdf"

/**
 * 判断文件扩展名是否属于总线支持的类型。
 */
export function isSupportedFileType(filePath: string): boolean {
  const supportedExtensions = new Set([
    // 文档
    'txt', 'md', 'json', 'xml', 'csv',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf',
    // 代码
    'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb',
    'sh', 'bat', 'ps1', 'sql', 'yaml', 'yml', 'toml', 'ini', 'cfg',
    // 媒体
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp',
    'mp3', 'wav', 'ogg', 'flac', 'aac',
    'mp4', 'mov', 'avi', 'mkv', 'webm',
    // 压缩
    'zip', 'tar', 'gz', '7z', 'rar',
  ]);

  const ext = getFileExtension(filePath);
  return supportedExtensions.has(ext);
}

/**
 * 获取文件扩展名（小写，无点）。
 * 例如 "report.pdf" → "pdf"，"image.JPG" → "jpg"。
 */
export function getFileExtension(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx === -1) return '';
  return filePath.slice(idx + 1).toLowerCase();
}
