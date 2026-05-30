import React, { useState, useEffect } from 'react';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { ChatPage } from './pages/Chat';
import { FilesPage } from './pages/Files';
import { ToastContainer } from './components/Toast';
import { CONFIG } from './config';
import './styles/dark.css';

type Page = 'dashboard' | 'chat' | 'files';

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [checking, setChecking] = useState(true);

  // 启动时检查是否已登录
  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      // 简单检查 token 是否存在，具体验证由各页面发起请求时处理
      setLoggedIn(true);
    }
    setChecking(false);
  }, []);

  const handleLogin = () => {
    setLoggedIn(true);
    setCurrentPage('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setLoggedIn(false);
  };

  if (checking) {
    return (
      <div className="login-page">
        <div className="spinner" />
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <>
        <LoginPage onLogin={handleLogin} />
        <ToastContainer />
      </>
    );
  }

  const navItems: { id: Page; label: string; icon: string }[] = [
    { id: 'dashboard', label: '仪表盘', icon: '📊' },
    { id: 'chat', label: '聊天', icon: '💬' },
    { id: 'files', label: '文件', icon: '📁' },
  ];

  const agentCount = ''; // 简单显示

  return (
    <div className="app-layout">
      <div className="app-header">
        <h1>🔌 Agent 消息总线</h1>
        <div className="header-right">
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>v1.0.0</span>
          <button className="btn btn-sm btn-secondary" onClick={handleLogout}>
            退出
          </button>
        </div>
      </div>
      <div className="app-content">
        <nav className="app-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.id)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        {currentPage === 'dashboard' && <DashboardPage />}
        {currentPage === 'chat' && <ChatPage />}
        {currentPage === 'files' && <FilesPage />}
      </div>
      <ToastContainer />
    </div>
  );
}

export default App;
