import { useState, useEffect, useCallback } from 'react'

const isElectron = window.electronAPI !== undefined
const API_BASE = 'http://localhost:3001/api'

function App() {
  const [ports, setPorts] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [protocol, setProtocol] = useState('all')
  const [sortBy, setSortBy] = useState('port')
  const [sortOrder, setSortOrder] = useState('asc')
  const [toast, setToast] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)
  const [killingPid, setKillingPid] = useState(null)

  const fetchPorts = useCallback(async () => {
    try {
      let data
      if (isElectron) {
        data = await window.electronAPI.getPorts({
          search,
          protocol,
          sortBy,
          sortOrder
        })
      } else {
        const params = new URLSearchParams({
          search,
          protocol,
          sortBy,
          sortOrder
        })
        const res = await fetch(`${API_BASE}/ports?${params}`)
        data = await res.json()
      }
      setPorts(data.ports || [])
    } catch (err) {
      console.error('Failed to fetch ports:', err)
      showToast('获取端口信息失败', 'error')
    }
  }, [search, protocol, sortBy, sortOrder])

  const fetchStats = useCallback(async () => {
    try {
      let data
      if (isElectron) {
        data = await window.electronAPI.getStats()
      } else {
        const res = await fetch(`${API_BASE}/stats`)
        data = await res.json()
      }
      setStats(data)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }, [])

  const loadAllData = useCallback(async () => {
    setRefreshing(true)
    if (isElectron) {
      await window.electronAPI.refreshData()
    }
    await Promise.all([fetchPorts(), fetchStats()])
    setLoading(false)
    setRefreshing(false)
  }, [fetchPorts, fetchStats])

  useEffect(() => {
    loadAllData()
  }, [loadAllData])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPorts()
    }, 300)
    return () => clearTimeout(timer)
  }, [search, protocol, sortBy, sortOrder, fetchPorts])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchPorts()
      fetchStats()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchPorts, fetchStats])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('asc')
    }
  }

  const handleKillClick = (port) => {
    setConfirmModal(port)
  }

  const confirmKill = async () => {
    if (!confirmModal) return

    const pid = confirmModal.pid
    setKillingPid(pid)

    try {
      let result
      if (isElectron) {
        result = await window.electronAPI.killProcess(pid)
      } else {
        const res = await fetch(`${API_BASE}/kill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pid })
        })
        const data = await res.json()
        result = { ...data, ok: res.ok }
      }

      if (result.success || result.ok) {
        showToast(`进程 ${pid} 已成功终止`, 'success')
        setConfirmModal(null)
        setTimeout(() => {
          fetchPorts()
          fetchStats()
        }, 500)
      } else {
        showToast(result.error || '终止进程失败', 'error')
      }
    } catch (err) {
      showToast('终止进程失败', 'error')
    } finally {
      setKillingPid(null)
    }
  }

  const getStateClass = (state) => {
    const s = state.toLowerCase()
    if (s.includes('listen')) return 'listening'
    if (s.includes('established')) return 'established'
    if (s.includes('time_wait')) return 'time_wait'
    if (s.includes('close_wait')) return 'close_wait'
    return 'default'
  }

  const getProtocolClass = (proto) => {
    return proto.toLowerCase().includes('tcp') ? 'tcp' : 'udp'
  }

  const getProcessIcon = (name) => {
    const n = name.toLowerCase()
    if (n.includes('node')) return '📦'
    if (n.includes('chrome') || n.includes('edge')) return '🌐'
    if (n.includes('firefox')) return '🦊'
    if (n.includes('code')) return '💻'
    if (n.includes('java')) return '☕'
    if (n.includes('python')) return '🐍'
    if (n.includes('docker')) return '🐳'
    if (n.includes('mysql') || n.includes('sql')) return '🗄️'
    if (n.includes('redis')) return '🔴'
    if (n.includes('nginx')) return '🚀'
    if (n.includes('system')) return '⚙️'
    if (n.includes('svchost')) return '🔧'
    return '📄'
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="brand">
            <div className="brand-icon">🔌</div>
            <div className="brand-text">
              <h1>端口监控仪表板</h1>
              <p>实时监控系统端口占用情况</p>
            </div>
          </div>
          <div className="header-actions">
            <button
              className={`refresh-btn ${refreshing ? 'refreshing' : ''}`}
              onClick={loadAllData}
              disabled={refreshing}
            >
              <span className={refreshing ? 'spin' : ''}>↻</span>
              {refreshing ? '刷新中...' : '刷新数据'}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="stats-grid">
          <div className="stat-card cyan">
            <div className="stat-label">总连接数</div>
            <div className="stat-value">{stats?.totalConnections || 0}</div>
            <div className="stat-sub">TCP + UDP 连接</div>
          </div>
          <div className="stat-card purple">
            <div className="stat-label">TCP 连接</div>
            <div className="stat-value">{stats?.tcpConnections || 0}</div>
            <div className="stat-sub">传输控制协议</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">活跃端口</div>
            <div className="stat-value">{stats?.uniquePorts || 0}</div>
            <div className="stat-sub">独立端口数量</div>
          </div>
          <div className="stat-card orange">
            <div className="stat-label">进程数</div>
            <div className="stat-value">{stats?.uniqueProcesses || 0}</div>
            <div className="stat-sub">占用端口的进程</div>
          </div>
        </div>

        <div className="controls-bar">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="搜索端口号、进程名、PID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <span className="filter-label">协议</span>
            <select
              className="filter-select"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h2>端口列表</h2>
            <span className="count-badge">共 {ports.length} 条</span>
          </div>
          <div className="table-wrapper">
            {loading ? (
              <div className="loading-state">
                <div className="loading-spinner"></div>
                <div className="loading-text">正在加载端口数据...</div>
              </div>
            ) : ports.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <div className="empty-text">没有找到匹配的端口</div>
                <div className="empty-sub">尝试修改搜索条件或筛选器</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th
                      className={sortBy === 'port' ? 'sorted' : ''}
                      onClick={() => handleSort('port')}
                    >
                      端口
                      <span className="sort-indicator">
                        {sortBy === 'port' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </th>
                    <th
                      className={sortBy === 'protocol' ? 'sorted' : ''}
                      onClick={() => handleSort('protocol')}
                    >
                      协议
                      <span className="sort-indicator">
                        {sortBy === 'protocol' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </th>
                    <th>本地地址</th>
                    <th
                      className={sortBy === 'processName' ? 'sorted' : ''}
                      onClick={() => handleSort('processName')}
                    >
                      进程名称
                      <span className="sort-indicator">
                        {sortBy === 'processName' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </th>
                    <th
                      className={sortBy === 'pid' ? 'sorted' : ''}
                      onClick={() => handleSort('pid')}
                    >
                      PID
                      <span className="sort-indicator">
                        {sortBy === 'pid' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ports.map((port, index) => (
                    <tr key={`${port.port}-${port.pid}-${index}`}>
                      <td className="port-cell">{port.port}</td>
                      <td>
                        <span className={`protocol-badge ${getProtocolClass(port.protocol)}`}>
                          {port.protocol.replace(/v6/i, '')}
                        </span>
                      </td>
                      <td className="address-cell">{port.localAddress}</td>
                      <td>
                        <div className="process-name">
                          <div className="process-icon">
                            {getProcessIcon(port.processName)}
                          </div>
                          {port.processName}
                        </div>
                      </td>
                      <td className="pid-cell">{port.pid}</td>
                      <td>
                        {port.state ? (
                          <span className={`state-badge ${getStateClass(port.state)}`}>
                            {port.state}
                          </span>
                        ) : (
                          <span className="state-badge default">-</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="kill-btn"
                          onClick={() => handleKillClick(port)}
                          disabled={killingPid === port.pid || port.pid <= 100}
                          title={port.pid <= 100 ? '系统进程不可终止' : '终止此进程'}
                        >
                          {killingPid === port.pid ? '终止中...' : '终止进程'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div className={`toast ${toast.type}`}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          {toast.message}
        </div>
      )}

      {confirmModal && (
        <div className="confirm-modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">⚠️</div>
            <div className="modal-title">确认终止进程？</div>
            <div className="modal-message">
              您确定要终止进程 <strong>{confirmModal.processName}</strong> (PID: {confirmModal.pid}) 吗？
              <br /><br />
              此操作将释放端口 <strong>{confirmModal.port}</strong>，但可能会导致相关服务异常。
            </div>
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => setConfirmModal(null)}
              >
                取消
              </button>
              <button
                className="modal-btn danger"
                onClick={confirmKill}
                disabled={killingPid === confirmModal.pid}
              >
                {killingPid === confirmModal.pid ? '终止中...' : '确认终止'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
