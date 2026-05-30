import React, { useEffect, useState } from 'react';
import { fetchFiles } from '../api/client';
import type { FileInfo } from '../types';
import { showToast } from '../components/Toast';

export function FilesPage() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 20;

  const load = async (p: number) => {
    setLoading(true);
    try {
      const resp = await fetchFiles(p, pageSize);
      setFiles(resp.items);
      setTotal(resp.total);
      setSelected(new Set());
    } catch (err: unknown) {
      showToast('error', `加载文件列表失败: ${err instanceof Error ? err.message : ''}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(page);
  }, [page]);

  const totalPages = Math.ceil(total / pageSize);
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatTime = (iso: string): string => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  if (loading && files.length === 0) {
    return (
      <div className="main-area">
        <div className="section-header">
          <h2>文件管理</h2>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="main-area">
      <div className="section-header">
        <h2>文件管理</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {selected.size > 0 && (
            <button className="btn btn-sm btn-secondary" disabled>
              下载 ({selected.size})
            </button>
          )}
          <button className="btn btn-sm btn-primary" disabled>
            + 上传文件
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelected(new Set(files.map((f) => f.file_id)));
                    } else {
                      setSelected(new Set());
                    }
                  }}
                  checked={files.length > 0 && selected.size === files.length}
                />
              </th>
              <th>文件名</th>
              <th>大小</th>
              <th>上传者</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                  暂无文件
                </td>
              </tr>
            )}
            {files.map((file) => (
              <tr key={file.file_id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(file.file_id)}
                    onChange={() => toggleSelect(file.file_id)}
                  />
                </td>
                <td>
                  <span style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                    📄 {file.file_name}
                  </span>
                </td>
                <td>{formatSize(file.file_size)}</td>
                <td>{file.uploaded_by}</td>
                <td>{formatTime(file.uploaded_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="page-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span className="page-info">第 {page} / {totalPages} 页</span>
          <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
