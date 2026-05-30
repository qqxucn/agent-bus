import React, { useState } from 'react';
import { verifyToken } from '../api/client';
import { showToast } from '../components/Toast';

interface Props {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: Props) {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    const t = token.trim();
    if (!t) {
      setError('请输入管理密码');
      return;
    }
    setLoading(true);
    setError('');

    try {
      // 先保存再验证
      localStorage.setItem('admin_token', t);
      const valid = await verifyToken();
      if (valid) {
        showToast('success', '登录成功');
        onLogin();
      } else {
        localStorage.removeItem('admin_token');
        setError('Token 无效，请检查后重试');
      }
    } catch (err) {
      localStorage.removeItem('admin_token');
      if (err instanceof TypeError) {
        setError('总线服务不可达，请确认服务已启动');
      } else {
        setError(`登录失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h2>🔌 Agent 消息总线</h2>
        <p>管理面板 · 请输入管理员密码以继续</p>
        <input
          type="password"
          placeholder="输入管理密码 (admin_token)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        {error && <div className="error-msg">{error}</div>}
        <button className="btn btn-primary btn-block" onClick={handleLogin} disabled={loading}>
          {loading ? '验证中...' : '登 录'}
        </button>
      </div>
    </div>
  );
}