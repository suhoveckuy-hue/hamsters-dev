import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ==================== API CLIENT ====================
const API_BASE = '/api';

class APIClient {
  constructor() {
    this.token = localStorage.getItem('hf_token');
  }

  async request(endpoint, options = {}, retry = true) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers, credentials: 'include' });
    
    // Try to refresh token on 401/403
    if ((response.status === 401 || response.status === 403) && retry && endpoint !== '/auth/login') {
      const refreshed = await this.refresh();
      if (refreshed) return this.request(endpoint, options, false);
    }
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async refresh() {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!response.ok) return false;
      const data = await response.json();
      this.setToken(data.accessToken);
      if (data.user) localStorage.setItem('hf_user', JSON.stringify(data.user));
      return true;
    } catch {
      return false;
    }
  }

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('hf_token', token);
    else localStorage.removeItem('hf_token');
  }

  async login(login, password) {
    const data = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
    this.setToken(data.accessToken);
    return data;
  }

  async logout() {
    try { await this.request('/auth/logout', { method: 'POST' }); } catch {}
    this.setToken(null);
  }

  async getWebmasters() { return this.request('/webmasters'); }
  async createWebmaster(d) { return this.request('/webmasters', { method: 'POST', body: JSON.stringify(d) }); }
  async updateWebmaster(id, d) { return this.request(`/webmasters/${id}`, { method: 'PATCH', body: JSON.stringify(d) }); }
  async deleteWebmaster(id) { return this.request(`/webmasters/${id}`, { method: 'DELETE' }); }
  async restoreWebmaster(id) { return this.request(`/webmasters/${id}/restore`, { method: 'POST' }); }

  async getTeamLeaders() { return this.request('/team-leaders'); }
  async createTeamLeader(d) { return this.request('/team-leaders', { method: 'POST', body: JSON.stringify(d) }); }
  async updateTeamLeader(id, d) { return this.request(`/team-leaders/${id}`, { method: 'PATCH', body: JSON.stringify(d) }); }
  async deleteTeamLeader(id) { return this.request(`/team-leaders/${id}`, { method: 'DELETE' }); }

  async getTransactions() { return this.request('/transactions'); }
  async createTransaction(d) { return this.request('/transactions', { method: 'POST', body: JSON.stringify(d) }); }
  async updateTransaction(id, d) { return this.request(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(d) }); }
  async deleteTransaction(id) { return this.request(`/transactions/${id}`, { method: 'DELETE' }); }

  async getLogs() { return this.request('/logs?limit=200'); }
}

const api = new APIClient();

const DEFAULT_DATA = {
  users: [],
  webmasters: [],
  teamLeaders: [],
  transactions: [],
  logs: [],
};

const WM_RANKS = ["junior", "middle", "senior", "senior_plus"];
const RANK_LABELS = { junior: "Джун", middle: "Мидл", senior: "Синьор", senior_plus: "Синьор+" };
const RANK_COLORS = { junior: "#38bdf8", middle: "#c084fc", senior: "#f59e0b", senior_plus: "#ef4444" };

// Bonus tables: [maxProfit, bonusPercent] — last entry has Infinity
const BONUS_TABLES = {
  junior: [
    [1999, 8], [4000, 10], [6000, 12], [8000, 15], [10000, 18], [Infinity, 20],
  ],
  middle: [
    [2000, 12], [4000, 15], [6000, 18], [8000, 21], [10000, 23], [15000, 25], [Infinity, 30],
  ],
  senior: [
    [2000, 15], [5000, 20], [8000, 25], [11000, 30], [14000, 35], [20000, 40], [30000, 45], [Infinity, 50],
  ],
  senior_plus: [
    [1999, 20], [4999, 25], [7999, 30], [10999, 35], [13999, 40], [16999, 45], [19999, 50], [24999, 55], [29999, 58], [Infinity, 60],
  ],
};

const calcBonus = (rank, grossProfit) => {
  if (grossProfit <= 0) return { percent: 0, amount: 0 };
  const table = BONUS_TABLES[rank] || BONUS_TABLES.junior;
  for (const [maxP, pct] of table) {
    if (grossProfit <= maxP) return { percent: pct, amount: Math.round(grossProfit * pct / 100) };
  }
  const last = table[table.length - 1];
  return { percent: last[1], amount: Math.round(grossProfit * last[1] / 100) };
};

// ==================== UTILS ====================
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ==================== SECURITY UTILS ====================
// Session timeout: 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const fmt = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const MONTHS = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

const getMonthKey = (dateStr) => {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const getMonthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
};

const getCurrentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const TYPE_LABELS = { revenue: "Доход", salary: "Зарплата", bonus: "Бонус", expense: "Расходник" };
const DAYS_OF_WEEK = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const FULL_MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

// ==================== DATE PICKER ====================
function DatePicker({ value, onChange, label, hint }) {
  const [open, setOpen] = useState(false);
  const parsed = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth());

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const select = (day) => {
    const m = String(viewMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onChange(`${viewYear}-${m}-${d}`);
    setOpen(false);
  };

  const prev = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); };
  const next = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); };

  const selectedDay = value ? parseInt(value.split("-")[2]) : null;
  const selectedMonth = value ? parseInt(value.split("-")[1]) - 1 : null;
  const selectedYear = value ? parseInt(value.split("-")[0]) : null;
  const isSelectedMonth = viewYear === selectedYear && viewMonth === selectedMonth;

  const displayValue = value || "Select date";

  return (
    <div style={{ position: "relative" }}>
      {label && <label style={dpStyles.label}>{label}</label>}
      <button onClick={() => setOpen(!open)} style={dpStyles.trigger} type="button">
        <span>📅</span>
        <span>{displayValue}</span>
        <span style={{ marginLeft: "auto", opacity: 0.4 }}>▾</span>
      </button>
      {hint && <div style={dpStyles.hint}>{hint}</div>}
      {open && (
        <>
          <div style={dpStyles.backdrop} onClick={() => setOpen(false)} />
          <div style={dpStyles.dropdown}>
            <div style={dpStyles.header}>
              <button onClick={prev} style={dpStyles.navBtn} type="button">◂</button>
              <span style={dpStyles.headerTitle}>{FULL_MONTHS[viewMonth]} {viewYear}</span>
              <button onClick={next} style={dpStyles.navBtn} type="button">▸</button>
            </div>
            <div style={dpStyles.weekRow}>
              {DAYS_OF_WEEK.map(d => <div key={d} style={dpStyles.weekDay}>{d}</div>)}
            </div>
            <div style={dpStyles.grid}>
              {cells.map((day, i) => day === null ? (
                <div key={`e${i}`} style={dpStyles.emptyCell} />
              ) : (
                <button
                  key={day}
                  onClick={() => select(day)}
                  type="button"
                  style={{
                    ...dpStyles.dayBtn,
                    ...(isSelectedMonth && day === selectedDay ? dpStyles.daySelected : {}),
                  }}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==================== MONTH PICKER ====================
function MonthPicker({ value, onChange, label, hint }) {
  const [open, setOpen] = useState(false);
  const curYear = value ? parseInt(value.split("-")[0]) : new Date().getFullYear();
  const curMonth = value ? parseInt(value.split("-")[1]) - 1 : new Date().getMonth();
  const [viewYear, setViewYear] = useState(curYear);

  const select = (m) => {
    onChange(`${viewYear}-${String(m + 1).padStart(2, "0")}`);
    setOpen(false);
  };

  const displayValue = value ? getMonthLabel(value) : "Select month";

  return (
    <div style={{ position: "relative" }}>
      {label && <label style={dpStyles.label}>{label}</label>}
      <button onClick={() => setOpen(!open)} style={dpStyles.trigger} type="button">
        <span>📊</span>
        <span>{displayValue}</span>
        <span style={{ marginLeft: "auto", opacity: 0.4 }}>▾</span>
      </button>
      {hint && <div style={dpStyles.hint}>{hint}</div>}
      {open && (
        <>
          <div style={dpStyles.backdrop} onClick={() => setOpen(false)} />
          <div style={dpStyles.dropdown}>
            <div style={dpStyles.header}>
              <button onClick={() => setViewYear(viewYear - 1)} style={dpStyles.navBtn} type="button">◂</button>
              <span style={dpStyles.headerTitle}>{viewYear}</span>
              <button onClick={() => setViewYear(viewYear + 1)} style={dpStyles.navBtn} type="button">▸</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: 8 }}>
              {MONTHS.map((name, i) => (
                <button
                  key={i}
                  onClick={() => select(i)}
                  type="button"
                  style={{
                    ...dpStyles.monthBtn,
                    ...(viewYear === curYear && i === curMonth ? dpStyles.daySelected : {}),
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const dpStyles = {
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#a1a1aa", marginBottom: 6 },
  hint: { fontSize: 10, color: "#71717a", marginTop: 4 },
  trigger: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #27272a", background: "#09090b", color: "#fafafa", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, textAlign: "left", boxSizing: "border-box" },
  backdrop: { position: "fixed", inset: 0, zIndex: 50 },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#27272a", border: "1px solid #3f3f46", borderRadius: 14, zIndex: 51, boxShadow: "0 12px 36px rgba(0,0,0,0.5)", overflow: "hidden" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px 8px" },
  headerTitle: { fontSize: 14, fontWeight: 700, color: "#fafafa" },
  navBtn: { width: 32, height: 32, borderRadius: 8, border: "none", background: "#3f3f46", color: "#fafafa", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 8px" },
  weekDay: { textAlign: "center", fontSize: 10, fontWeight: 700, color: "#71717a", padding: 4, textTransform: "uppercase" },
  grid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, padding: "4px 8px 10px" },
  emptyCell: { width: "100%", aspectRatio: "1", },
  dayBtn: { width: "100%", aspectRatio: "1", borderRadius: 8, border: "none", background: "transparent", color: "#d4d4d8", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s" },
  daySelected: { background: "linear-gradient(135deg, #9333ea, #7c3aed)", color: "#fff", fontWeight: 700 },
  monthBtn: { padding: "10px 8px", borderRadius: 8, border: "none", background: "transparent", color: "#d4d4d8", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.1s" },
};

// ==================== MAIN APP ====================
export default function App() {
  const [data, setData] = useState({ ...DEFAULT_DATA });
  const [loaded, setLoaded] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [selectedWm, setSelectedWm] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [editTx, setEditTx] = useState(null);
  const lastActivityRef = useRef(Date.now());

  // Session timeout: reset timer on user activity
  useEffect(() => {
    if (!currentUser) return;
    const resetTimer = () => { lastActivityRef.current = Date.now(); };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach(e => window.addEventListener(e, resetTimer));
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > SESSION_TIMEOUT_MS) {
        api.setToken(null);
        localStorage.removeItem('hf_user');
        setCurrentUser(null);
        setView("dashboard");
        setSelectedWm(null);
        setModal(null);
      }
    }, 60000);
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      clearInterval(interval);
    };
  }, [currentUser]);

  // Load all data from API on mount
  useEffect(() => {
    const token = localStorage.getItem('hf_token');
    if (!token) {
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const [wms, tls, txs, logs] = await Promise.all([
          api.getWebmasters(),
          api.getTeamLeaders(),
          api.getTransactions(),
          api.getLogs(),
        ]);
        // Map API fields to match original data structure
        const webmasters = wms.map(w => ({
          ...w,
          wmId: w.wm_id,
          teamLeaderId: w.team_leader_id,
          firedDate: w.fired_date ? String(w.fired_date).slice(0, 10) : null,
          userId: w.id,
        }));
        const teamLeaders = tls;
        const transactions = txs.map(t => ({
          ...t,
          wmId: t.wm_id,
          reportMonth: t.report_month,
          amount: parseFloat(t.amount),
          date: t.date ? String(t.date).slice(0, 10) : t.date,
        }));
        // Restore user FIRST then data (same batch = no empty render)
        const savedUser = localStorage.getItem('hf_user');
        if (savedUser) { try { setCurrentUser(JSON.parse(savedUser)); } catch {} }
        setData(prev => ({ ...prev, webmasters, teamLeaders, transactions, logs }));
      } catch (e) {
        // Token invalid, clear it
        api.setToken(null);
        localStorage.removeItem('hf_user');
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const showToast = (msg, type = "success") => setToast({ msg, type });

  const updateData = useCallback((fn) => {
    setData((prev) => {
      const next = { ...prev };
      fn(next);
      return next;
    });
  }, []);

  const addLog = useCallback((action, details) => {
    updateData((d) => {
      if (!d.logs) d.logs = [];
      d.logs.unshift({
        id: uid(),
        action,
        details,
        userId: currentUser?.id || "system",
        userName: currentUser?.name || "System",
        timestamp: new Date().toISOString(),
      });
      if (d.logs.length > 500) d.logs = d.logs.slice(0, 500);
    });
    // Also refresh logs from API in background
    api.getLogs().then(logs => {
      updateData(d => {
        d.logs = logs.map(l => ({...l, userId: l.user_id, userName: l.user_name}));
      });
    }).catch(() => {});
  }, [currentUser, updateData]);

  // Reload all data from API
  const reloadData = useCallback(async () => {
    try {
      const [wms, tls, txs, logs] = await Promise.all([
        api.getWebmasters(),
        api.getTeamLeaders(),
        api.getTransactions(),
        api.getLogs(),
      ]);
      setData(prev => ({
        ...prev,
        webmasters: wms.map(w => ({
          ...w,
          wmId: w.wm_id,
          teamLeaderId: w.team_leader_id,
          firedDate: w.fired_date ? String(w.fired_date).slice(0, 10) : null,
          userId: w.id,
        })),
        teamLeaders: tls,
        transactions: txs.map(t => ({
          ...t,
          wmId: t.wm_id,
          reportMonth: t.report_month,
          amount: parseFloat(t.amount),
          date: t.date ? String(t.date).slice(0, 10) : t.date,
        })),
        logs: logs.map(l => ({...l, userId: l.user_id, userName: l.user_name})),
      }));
    } catch (e) {
      console.error('Failed to reload data:', e);
    }
  }, []);

  // ==================== GLOBAL CSS RESET ====================
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'hf-global-reset';
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow-x: hidden; }
      #root { min-height: 100vh; }
    `;
    if (!document.getElementById('hf-global-reset')) {
      document.head.appendChild(style);
    }
    return () => {
      const el = document.getElementById('hf-global-reset');
      if (el) el.remove();
    };
  }, []);

  // ==================== AUTH ====================
  if (!loaded) {
    return (
      <div style={{ ...styles.loginWrap, flexDirection: "column", gap: 16 }}>
        <div style={{ ...styles.logoIcon, fontSize: 36, width: 64, height: 64 }}>H</div>
        <div style={{ color: "#a1a1aa", fontSize: 14 }}>Загрузка...</div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen data={data} onLogin={(user) => { setCurrentUser(user); reloadData(); }} updateData={updateData} />;
  }

  const isAdmin = currentUser.role === "admin";
  const isFinance = currentUser.role === "finance";
  const isWebmaster = currentUser.role === "webmaster";
  const isTeamLead = currentUser.role === "teamlead";

  const canEdit = isAdmin || isFinance;

  // Get TL id from currentUser.id (format: "tl_xxx")
  const currentTlId = isTeamLead ? currentUser.id.replace("tl_", "") : null;

  const visibleWms = isWebmaster
    ? data.webmasters.filter((w) => w.id === currentUser.id)
    : isTeamLead
    ? data.webmasters.filter((w) => w.teamLeaderId === currentTlId)
    : data.webmasters;

  const visibleTransactions = isWebmaster
    ? data.transactions.filter((t) => t.wmId === currentUser.id)
    : isTeamLead
    ? data.transactions.filter((t) => {
        const wm = data.webmasters.find((w) => w.id === t.wmId);
        return wm && wm.teamLeaderId === currentTlId;
      })
    : data.transactions;

  return (
    <div style={styles.app}>
      {toast && (
        <div style={{ ...styles.toast, background: toast.type === "error" ? "#ef4444" : "#10b981" }}>
          {toast.msg}
        </div>
      )}

      {/* SIDEBAR */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTop}>
          <div style={styles.logo}>
            <div style={styles.logoIcon}>H</div>
            <span style={styles.logoText}>Hamsters Finance</span>
          </div>
          <div style={styles.userBadge}>
            <div style={styles.avatar}>{(currentUser.name || "?")[0]}</div>
            <div>
              <div style={styles.userName}>{currentUser.name}</div>
              <div style={styles.userRole}>
                {currentUser.role === "admin" ? "Администратор" : currentUser.role === "finance" ? "Фин. менеджер" : currentUser.role === "teamlead" ? "Тим-лидер" : "Вебмастер"}
              </div>
            </div>
          </div>
        </div>

        <nav style={styles.nav}>
          {[
            { id: "dashboard", icon: "◉", label: "Дашборд" },
            ...(!isWebmaster ? [{ id: "webmasters", icon: "◎", label: isTeamLead ? "Мои вебмастера" : "Вебмастера" }] : []),
            ...(canEdit ? [{ id: "teamleads", icon: "◐", label: "Тим-лидеры" }] : []),
            ...(canEdit ? [{ id: "transactions", icon: "◈", label: "Транзакции" }] : []),
            ...(canEdit ? [{ id: "logs", icon: "◆", label: "Журнал действий" }] : []),
            ...(isAdmin ? [{ id: "users", icon: "◇", label: "Пользователи" }] : []),
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => { setView(item.id); setSelectedWm(null); }}
              style={{
                ...styles.navItem,
                ...(view === item.id ? styles.navItemActive : {}),
              }}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <button onClick={async () => {
          await api.logout();
          localStorage.removeItem('hf_user');
          setCurrentUser(null);
          setData({ ...DEFAULT_DATA });
          setView("dashboard");
          setSelectedWm(null);
        }} style={styles.logout}>
          ↩ Выход
        </button>
      </aside>

      {/* MAIN */}
      <main style={styles.main}>
        {view === "dashboard" && (
          <DashboardView
            webmasters={visibleWms}
            transactions={visibleTransactions}
            onSelectWm={(wm) => { setSelectedWm(wm); setView("webmasters"); }}
            canEdit={canEdit}
            onAddTx={() => setModal("addTxGlobal")}
          />
        )}
        {view === "webmasters" && !selectedWm && !isWebmaster && (
          <WebmastersListView
            webmasters={visibleWms}
            transactions={visibleTransactions}
            teamLeaders={data.teamLeaders || []}
            canEdit={canEdit}
            onSelect={setSelectedWm}
            onAdd={() => setModal("addWm")}
          />
        )}
        {view === "webmasters" && selectedWm && (
          <WebmasterDetailView
            wm={selectedWm}
            teamLeader={isWebmaster ? null : (data.teamLeaders || []).find(tl => tl.id === selectedWm.teamLeaderId)}
            transactions={data.transactions.filter((t) => t.wmId === selectedWm.id)}
            canEdit={canEdit}
            onBack={() => setSelectedWm(null)}
            onAddTx={() => setModal("addTx")}
            onEditWm={() => setModal("editWm")}
            onDeleteWm={() => setModal("confirmDeleteWm")}
            onRestoreWm={async () => {
              try {
                const name = selectedWm.name;
                await api.restoreWebmaster(selectedWm.id);
                await reloadData();
                addLog("wm_restored", `Restored webmaster "${name}"`);
                setSelectedWm({ ...selectedWm, fired: false, firedDate: null });
                showToast(`${name} восстановлен`);
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }}
            onEditTx={(tx) => { setEditTx(tx); setModal("editTx"); }}
            onDeleteTx={async (txId) => {
              try {
                const tx = data.transactions.find(t => t.id === txId);
                await api.deleteTransaction(txId);
                await reloadData();
                addLog("tx_deleted", `Deleted ${tx?.type} ${fmt(tx?.amount || 0)} for "${selectedWm.name}" — ${tx?.description || "no description"}`);
                showToast("Операция удалена");
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }}
          />
        )}
        {view === "teamleads" && canEdit && (
          <TeamLeadersView
            teamLeaders={data.teamLeaders || []}
            webmasters={visibleWms}
            transactions={visibleTransactions}
            canEdit={canEdit}
            updateData={updateData}
            addLog={addLog}
            showToast={showToast}
            reloadData={reloadData}
            onSelectWm={(wm) => { setSelectedWm(wm); setView("webmasters"); }}
          />
        )}
        {view === "transactions" && (
          <TransactionsView
            transactions={visibleTransactions}
            webmasters={visibleWms}
            canEdit={canEdit}
            onAddTx={() => setModal("addTxGlobal")}
            onEditTx={(tx) => { setEditTx(tx); setModal("editTx"); }}
            onDeleteTx={async (txId) => {
              try {
                const tx = data.transactions.find(t => t.id === txId);
                const wmName = data.webmasters.find(w => w.id === tx?.wmId)?.name || "?";
                await api.deleteTransaction(txId);
                await reloadData();
                addLog("tx_deleted", `Deleted ${tx?.type} ${fmt(tx?.amount || 0)} for "${wmName}" — ${tx?.description || "no description"}`);
                showToast("Операция удалена");
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }}
          />
        )}
        {view === "users" && isAdmin && (
          <UsersView
            data={data}
            updateData={updateData}
            showToast={showToast}
            addLog={addLog}
          />
        )}
        {view === "logs" && canEdit && (
          <ActivityLogView logs={data.logs || []} users={data.users} webmasters={data.webmasters} />
        )}
      </main>

      {/* MODALS */}
      {modal === "addWm" && (
        <Modal title="Добавить вебмастера" onClose={() => setModal(null)}>
          <AddWebmasterForm
            data={data}
            onSave={async (wm) => {
              try {
                await api.createWebmaster({
                  name: wm.name,
                  team: wm.team || null,
                  login: wm.login,
                  password: wm.pin,
                  teamLeaderId: wm.teamLeaderId || null,
                  rank: wm.rank || 'junior',
                });
                await reloadData();
                addLog("webmaster_added", `Added webmaster "${wm.name}"${wm.team ? ` (${wm.team})` : ""}`);
                setModal(null);
                showToast("Вебмастер добавлен");
              } catch(e) {
                alert("Ошибка: " + e.message);
              }
            }}
          />
        </Modal>
      )}
      {modal === "addTx" && selectedWm && (
        <Modal title={`Новая операция — ${selectedWm.name}`} onClose={() => setModal(null)}>
          <AddTransactionForm
            wmId={selectedWm.id}
            userId={currentUser.id}
            onSave={async (tx) => {
              try {
                await api.createTransaction({
                  wmId: tx.wmId,
                  type: tx.type,
                  amount: tx.amount,
                  description: tx.description || null,
                  category: tx.category || null,
                  date: tx.date,
                  reportMonth: tx.reportMonth,
                });
                await reloadData();
                addLog("tx_created", `${tx.type} ${fmt(tx.amount)} for "${selectedWm.name}" — ${tx.description || "no description"}`);
                setModal(null);
                showToast("Операция записана");
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }}
          />
        </Modal>
      )}
      {modal === "addTxGlobal" && (
        <Modal title="Новая операция" onClose={() => setModal(null)}>
          <AddTransactionFormGlobal
            webmasters={visibleWms}
            userId={currentUser.id}
            onSave={async (tx) => {
              try {
                const wmName = data.webmasters.find(w => w.id === tx.wmId)?.name || "?";
                await api.createTransaction({
                  wmId: tx.wmId,
                  type: tx.type,
                  amount: tx.amount,
                  description: tx.description || null,
                  category: tx.category || null,
                  date: tx.date,
                  reportMonth: tx.reportMonth,
                });
                await reloadData();
                addLog("tx_created", `${tx.type} ${fmt(tx.amount)} for "${wmName}" — ${tx.description || "no description"}`);
                setModal(null);
                showToast("Операция записана");
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }}
          />
        </Modal>
      )}
      {modal === "editTx" && editTx && (
        <Modal title="Редактирование операции" onClose={() => { setModal(null); setEditTx(null); }}>
          <EditTransactionForm
            tx={editTx}
            webmasters={visibleWms}
            onSave={async (updated) => {
              const wmName = data.webmasters.find(w => w.id === updated.wmId)?.name || "?";
              const oldTx = data.transactions.find(t => t.id === updated.id);
              const changes = [];
              if (oldTx?.amount !== updated.amount) changes.push(`amount: ${fmt(oldTx?.amount || 0)} → ${fmt(updated.amount)}`);
              if (oldTx?.type !== updated.type) changes.push(`type: ${oldTx?.type} → ${updated.type}`);
              if (oldTx?.description !== updated.description) changes.push(`desc: "${oldTx?.description || "—"}" → "${updated.description || "—"}"`);
              if (oldTx?.date !== updated.date) changes.push(`date: ${oldTx?.date} → ${updated.date}`);
              try {
                await api.updateTransaction(updated.id, {
                  type: updated.type,
                  amount: updated.amount,
                  description: updated.description || null,
                  category: updated.category || null,
                  date: updated.date,
                  reportMonth: updated.reportMonth,
                  wmId: updated.wmId,
                });
                await reloadData();
                addLog("tx_edited", `Edited ${updated.type} for "${wmName}": ${changes.join(", ") || "no changes"}`);
                setModal(null);
                setEditTx(null);
                showToast("Операция обновлена");
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }}
          />
        </Modal>
      )}
      {modal === "editWm" && selectedWm && (
        <Modal title={`Настройки — ${selectedWm.name}`} onClose={() => setModal(null)}>
          <EditWebmasterForm
            wm={selectedWm}
            teamLeaders={data.teamLeaders || []}
            onSave={async (updated) => {
              const changes = [];
              if (selectedWm.pin !== updated.pin) changes.push("PIN changed");
              if (selectedWm.name !== updated.name) changes.push(`name: "${selectedWm.name}" → "${updated.name}"`);
              if (selectedWm.team !== updated.team) changes.push(`team: "${selectedWm.team || "—"}" → "${updated.team || "—"}"`);
              if (selectedWm.teamLeaderId !== updated.teamLeaderId) {
                const oldTl = (data.teamLeaders || []).find(t => t.id === selectedWm.teamLeaderId)?.name || "none";
                const newTl = (data.teamLeaders || []).find(t => t.id === updated.teamLeaderId)?.name || "none";
                changes.push(`TL: "${oldTl}" → "${newTl}"`);
              }
              try {
                await api.updateWebmaster(updated.id, {
                  name: updated.name,
                  team: updated.team || null,
                  teamLeaderId: updated.teamLeaderId || null,
                  rank: updated.rank,
                });
                await reloadData();
                addLog("wm_edited", `Edited webmaster "${updated.name}": ${changes.join(", ") || "no changes"}`);
                setSelectedWm({ ...selectedWm, ...updated });
                setModal(null);
                showToast("Вебмастер обновлён");
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }}
          />
        </Modal>
      )}
      {modal === "confirmDeleteWm" && selectedWm && (
        <Modal title="Увольнение вебмастера" onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: 16, background: "#ef444410", borderRadius: 12, border: "1px solid #ef444433" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>Are you sure you want to fire {selectedWm.name}?</div>
              <div style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.6 }}>
                Вебмастер будет отмечен как уволенный. Все {data.transactions.filter(t => t.wmId === selectedWm.id).length} транзакции сохранятся для отчётности.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setModal(null)} style={{ ...styles.btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={async () => {
                const name = selectedWm.name;
                const txCount = data.transactions.filter(t => t.wmId === selectedWm.id).length;
                try {
                  await api.updateWebmaster(selectedWm.id, {
                    fired: true,
                    firedDate: new Date().toISOString().slice(0, 10),
                  });
                  await reloadData();
                  addLog("wm_fired", `Fired webmaster "${name}" (${txCount} transactions preserved)`);
                  setSelectedWm(null);
                  setModal(null);
                  showToast(`${name} уволен`);
                } catch(e) {
                  showToast("Ошибка: " + e.message, "error");
                }
              }} style={{ ...styles.btnPrimary, flex: 1, background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>
                Подтвердить увольнение
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function LoginScreen({ data, onLogin, updateData }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const pwdRef = useRef(null);

  const isLocked = lockedUntil && Date.now() < lockedUntil;
  const lockSecsLeft = isLocked ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0;

  const allUsers = [
    ...data.users.map(u => ({ ...u, login: u.login || u.name.toLowerCase().replace(/\s+/g, "") })),
    ...(data.teamLeaders || [])
      .map((tl) => ({ id: `tl_${tl.id}`, name: tl.name, role: "teamlead", login: tl.login || tl.name.toLowerCase().replace(/\s+/g, ""), pin: tl.pin || "0000" })),
    ...data.webmasters
      .filter((w) => w.userId && !w.fired)
      .map((w) => ({ id: w.userId, name: w.name, role: "webmaster", login: w.login || w.name.toLowerCase().replace(/\s+/g, ""), pin: w.pin || "0000" })),
  ];

  const handleLogin = async () => {
    if (isLocked) return;
    const trimLogin = login.trim().toLowerCase();
    if (!trimLogin) return setError("Введите логин");
    if (!password) return setError("Введите пароль");

    try {
      const data = await api.login(trimLogin, password);
      const user = { ...data.user, role: data.user.role };
      localStorage.setItem('hf_user', JSON.stringify(user));
      setAttempts(0);
      onLogin(user);
    } catch (err) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setPassword("");
      if (newAttempts >= 5) {
        setLockedUntil(Date.now() + 30000);
        setAttempts(0);
        return setError("Слишком много попыток. Подождите 30 секунд.");
      }
      setError("Неверный логин или пароль");
    }
  };

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <div style={styles.loginLogo}>
          <div style={{ ...styles.logoIcon, fontSize: 36, width: 64, height: 64 }}>H</div>
        </div>
        <h1 style={styles.loginTitle}>Hamsters Finance</h1>
        <p style={styles.loginSub}>Финансовая платформа команды Hamsters</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
          <div>
            <label style={styles.formLabel}>Login</label>
            <input
              type="text"
              value={login}
              onChange={(e) => { setLogin(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && pwdRef.current?.focus()}
              placeholder="Введите логин"
              style={styles.input}
              autoFocus
              autoComplete="username"
              disabled={isLocked}
            />
          </div>
          <div>
            <label style={styles.formLabel}>Password</label>
            <input
              ref={pwdRef}
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && login && password && handleLogin()}
              placeholder="Введите пароль"
              style={styles.input}
              autoComplete="current-password"
              disabled={isLocked}
            />
          </div>
          {isLocked && (
            <div style={{ ...styles.errorText, color: "#f59e0b" }}>
              Аккаунт заблокирован на {lockSecsLeft} сек.
            </div>
          )}
          {error && !isLocked && <div style={styles.errorText}>{error}</div>}
          <button
            onClick={handleLogin}
            disabled={!login.trim() || !password || isLocked}
            style={{ ...styles.btnPrimary, padding: "12px 20px", fontSize: 15, opacity: (login.trim() && password && !isLocked) ? 1 : 0.5 }}
          >
            Войти
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== DASHBOARD ====================
function DashboardView({ webmasters, transactions, onSelectWm, canEdit, onAddTx }) {
  const stats = useMemo(() => {
    const totalRevenue = transactions.filter((t) => t.type === "revenue").reduce((s, t) => s + t.amount, 0);
    const totalSalary = transactions.filter((t) => t.type === "salary").reduce((s, t) => s + t.amount, 0);
    const totalBonus = transactions.filter((t) => t.type === "bonus").reduce((s, t) => s + t.amount, 0);
    const totalExpense = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const totalCost = totalSalary + totalBonus + totalExpense;
    const netProfit = totalRevenue - totalCost;
    const grossProfit = totalRevenue - totalExpense;
    return { totalRevenue, totalSalary, totalBonus, totalExpense, totalCost, netProfit, grossProfit };
  }, [transactions]);

  const wmStats = useMemo(() => {
    return webmasters.map((wm) => {
      const wmTx = transactions.filter((t) => t.wmId === wm.id);
      const revenue = wmTx.filter((t) => t.type === "revenue").reduce((s, t) => s + t.amount, 0);
      const costs = wmTx.filter((t) => t.type !== "revenue").reduce((s, t) => s + t.amount, 0);
      const expenses = wmTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      return { ...wm, revenue, costs, grossProfit: revenue - expenses, netProfit: revenue - costs };
    }).sort((a, b) => b.netProfit - a.netProfit);
  }, [webmasters, transactions]);

  const monthlyData = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      const mk = t.reportMonth || getMonthKey(t.date);
      if (!map[mk]) map[mk] = { revenue: 0, costs: 0 };
      if (t.type === "revenue") map[mk].revenue += t.amount;
      else map[mk].costs += t.amount;
    });
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).slice(-6);
  }, [transactions]);

  const maxMonthly = Math.max(...monthlyData.map(([, d]) => Math.max(d.revenue, d.costs)), 1);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ ...styles.pageTitle, marginBottom: 0 }}>Dashboard</h1>
        {canEdit && webmasters.length > 0 && <button onClick={onAddTx} style={styles.btnPrimary}>+ Добавить операцию</button>}
      </div>

      {/* STAT CARDS */}
      <div style={{ ...styles.statGrid, gridTemplateColumns: canEdit ? "repeat(5, 1fr)" : "repeat(4, 1fr)" }}>
        {(canEdit ? [
          { label: "Общий доход", value: fmt(stats.totalRevenue), color: "#10b981", icon: "↑" },
          { label: "Общие затраты", value: fmt(stats.totalCost), color: "#f59e0b", icon: "↓" },
          { label: "Профит Нетто", value: fmt(stats.grossProfit), color: stats.grossProfit >= 0 ? "#c084fc" : "#ef4444", icon: stats.grossProfit >= 0 ? "▲" : "▼" },
          { label: "Чистый профит", value: fmt(stats.netProfit), color: stats.netProfit >= 0 ? "#10b981" : "#ef4444", icon: stats.netProfit >= 0 ? "▲" : "▼" },
          { label: "Вебмастера", value: webmasters.length, color: "#9333ea", icon: "◎" },
        ] : [
          { label: "Доход", value: fmt(stats.totalRevenue), color: "#10b981", icon: "↑" },
          { label: "Зарплата", value: fmt(stats.totalSalary), color: "#9333ea", icon: "💰" },
          { label: "Бонус", value: fmt(stats.totalBonus), color: "#f59e0b", icon: "🎁" },
          { label: "Расходники", value: fmt(stats.totalExpense), color: "#ef4444", icon: "📦" },
        ]).map((s, i) => (
          <div key={i} style={styles.statCard}>
            <div style={{ ...styles.statIcon, background: s.color + "18", color: s.color }}>{s.icon}</div>
            <div style={styles.statLabel}>{s.label}</div>
            <div style={{ ...styles.statValue, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* COST BREAKDOWN */}
      <div style={styles.cardRow}>
        {canEdit && <div style={{ ...styles.card, flex: 1 }}>
          <h3 style={styles.cardTitle}>Структура затрат</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "Зарплаты", val: stats.totalSalary, color: "#9333ea" },
              { label: "Бонусы", val: stats.totalBonus, color: "#f59e0b" },
              { label: "Расходники", val: stats.totalExpense, color: "#ef4444" },
            ].map((item, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: "#71717a" }}>{item.label}</span>
                  <span style={{ fontWeight: 700, color: item.color }}>{fmt(item.val)}</span>
                </div>
                <div style={{ height: 6, background: "#fafafa", borderRadius: 3 }}>
                  <div style={{ height: 6, borderRadius: 3, background: item.color, width: `${stats.totalCost ? (item.val / stats.totalCost) * 100 : 0}%`, transition: "width 0.5s" }} />
                </div>
              </div>
            ))}
          </div>
        </div>}

        <div style={{ ...styles.card, flex: 1.5 }}>
          <h3 style={styles.cardTitle}>Обзор по месяцам (последние 6)</h3>
          {monthlyData.length === 0 ? (
            <div style={styles.emptyState}>Нет данных</div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 140 }}>
              {monthlyData.map(([mk, d]) => (
                <div key={mk} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 110 }}>
                    <div style={{ width: 14, background: "#10b981", borderRadius: "3px 3px 0 0", height: `${(d.revenue / maxMonthly) * 100}%`, minHeight: 2, transition: "height 0.5s" }} title={`Revenue: ${fmt(d.revenue)}`} />
                    <div style={{ width: 14, background: "#f59e0b", borderRadius: "3px 3px 0 0", height: `${(d.costs / maxMonthly) * 100}%`, minHeight: 2, transition: "height 0.5s" }} title={`Costs: ${fmt(d.costs)}`} />
                  </div>
                  <div style={{ fontSize: 10, color: "#a1a1aa" }}>{getMonthLabel(mk).slice(0, 3)}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11 }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#10b981", marginRight: 4 }}/>Доход</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#f59e0b", marginRight: 4 }}/>Затраты</span>
          </div>
        </div>
      </div>

      {/* TOP WEBMASTERS */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Эффективность вебмастеров</h3>
        {wmStats.length === 0 ? (
          <div style={styles.emptyState}>Вебмастеров пока нет. Добавьте первого вебмастера.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Вебмастер</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Доход</th>
                  {canEdit && <th style={{ ...styles.th, textAlign: "right" }}>Затраты</th>}
                  {canEdit && <th style={{ ...styles.th, textAlign: "right" }}>Профит Нетто</th>}
                  {canEdit && <th style={{ ...styles.th, textAlign: "right" }}>Чистый профит</th>}
                  {canEdit && <th style={{ ...styles.th, textAlign: "right" }}>ROI</th>}
                </tr>
              </thead>
              <tbody>
                {wmStats.map((wm) => (
                  <tr key={wm.id} onClick={() => onSelectWm(wm)} style={styles.tableRow}>
                    <td style={styles.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ ...styles.avatar, width: 32, height: 32, fontSize: 12 }}>{(wm.name || "?")[0]}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{wm.name}</div>
                          {wm.team && <div style={{ fontSize: 11, opacity: 0.5 }}>{wm.team}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", color: "#10b981", fontWeight: 600 }}>{fmt(wm.revenue)}</td>
                    {canEdit && <td style={{ ...styles.td, textAlign: "right", color: "#f59e0b" }}>{fmt(wm.costs)}</td>}
                    {canEdit && <td style={{ ...styles.td, textAlign: "right", fontWeight: 600, color: wm.grossProfit >= 0 ? "#c084fc" : "#ef4444" }}>{fmt(wm.grossProfit)}</td>}
                    {canEdit && <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: wm.netProfit >= 0 ? "#10b981" : "#ef4444" }}>{fmt(wm.netProfit)}</td>}
                    {canEdit && <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
                      {wm.costs > 0 ? `${Math.round((wm.netProfit / wm.costs) * 100)}%` : "—"}
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== WEBMASTERS LIST ====================
function WebmastersListView({ webmasters, transactions, teamLeaders, canEdit, onSelect, onAdd }) {
  const getTlName = (id) => { const tl = (teamLeaders || []).find(t => t.id === id); return tl ? tl.name : null; };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={styles.pageTitle}>Вебмастера</h1>
        {canEdit && <button onClick={onAdd} style={styles.btnPrimary}>+ Добавить Вебмастер</button>}
      </div>

      {webmasters.length === 0 ? (
        <div style={{ ...styles.card, ...styles.emptyState, padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>◎</div>
          Вебмастеров пока нет
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {webmasters.map((wm) => {
            const wmTx = transactions.filter((t) => t.wmId === wm.id);
            const rev = wmTx.filter((t) => t.type === "revenue").reduce((s, t) => s + t.amount, 0);
            const salary = wmTx.filter((t) => t.type === "salary").reduce((s, t) => s + t.amount, 0);
            const bonus = wmTx.filter((t) => t.type === "bonus").reduce((s, t) => s + t.amount, 0);
            const expense = wmTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
            const cost = salary + bonus + expense;
            const profit = rev - cost;
            const grossProfit = rev - expense;
            const tlName = getTlName(wm.teamLeaderId);
            return (
              <div key={wm.id} onClick={() => onSelect(wm)} style={{ ...styles.wmCard, ...(wm.fired ? { opacity: 0.6, borderColor: "#ef444433" } : {}) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{ ...styles.avatar, width: 44, height: 44, fontSize: 18, ...(wm.fired ? { background: "linear-gradient(135deg, #52525b, #3f3f46)" } : {}) }}>{(wm.name || "?")[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {wm.name}
                      <span style={{ fontSize: 10, fontWeight: 700, color: RANK_COLORS[wm.rank || "junior"], background: (RANK_COLORS[wm.rank || "junior"]) + "18", padding: "2px 8px", borderRadius: 6 }}>{RANK_LABELS[wm.rank || "junior"]}</span>
                      {wm.fired && <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", background: "#ef444418", padding: "2px 8px", borderRadius: 6, textTransform: "uppercase" }}>Уволен {wm.firedDate ? String(wm.firedDate).slice(0, 10) : ""}</span>}
                    </div>
                    {wm.team && <div style={{ fontSize: 12, opacity: 0.5 }}>{wm.team}</div>}
                  </div>
                </div>
                {tlName && (
                  <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#71717a" }}>TL:</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#c084fc", background: "#9333ea0d", padding: "2px 8px", borderRadius: 6 }}>{tlName}</span>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={styles.wmStat}><div style={{ fontSize: 11, color: "#a1a1aa" }}>Доход</div><div style={{ fontWeight: 700, color: "#10b981" }}>{fmt(rev)}</div></div>
                  <div style={styles.wmStat}><div style={{ fontSize: 11, color: "#a1a1aa" }}>Расходники</div><div style={{ fontWeight: 700, color: "#ef4444" }}>{fmt(expense)}</div></div>
                  <div style={styles.wmStat}><div style={{ fontSize: 11, color: "#a1a1aa" }}>Зарплата</div><div style={{ fontWeight: 700, color: "#9333ea" }}>{fmt(salary)}</div></div>
                  <div style={styles.wmStat}><div style={{ fontSize: 11, color: "#a1a1aa" }}>Бонус</div><div style={{ fontWeight: 700, color: "#f59e0b" }}>{fmt(bonus)}</div></div>
                  {canEdit && <div style={styles.wmStat}><div style={{ fontSize: 11, color: "#a1a1aa" }}>Профит Нетто</div><div style={{ fontWeight: 700, color: grossProfit >= 0 ? "#c084fc" : "#ef4444" }}>{fmt(grossProfit)}</div></div>}
                  {canEdit && <div style={styles.wmStat}><div style={{ fontSize: 11, color: "#a1a1aa" }}>Чистый профит</div><div style={{ fontWeight: 700, color: profit >= 0 ? "#10b981" : "#ef4444" }}>{fmt(profit)}</div></div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== WEBMASTER DETAIL ====================
function WebmasterDetailView({ wm, teamLeader, transactions, canEdit, onBack, onAddTx, onEditTx, onDeleteTx, onEditWm, onDeleteWm, onRestoreWm }) {
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("analytics"); // analytics | transactions
  const [selectedMonth, setSelectedMonth] = useState("all");

  // Build monthly breakdown
  const monthlyMap = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      const mk = t.reportMonth || getMonthKey(t.date);
      if (!map[mk]) map[mk] = { revenue: 0, salary: 0, bonus: 0, expense: 0, costs: 0, profit: 0, grossProfit: 0, bonusBase: 0, txCount: 0 };
      if (t.type === "revenue") {
        map[mk].revenue += t.amount;
      } else {
        map[mk][t.type] = (map[mk][t.type] || 0) + t.amount;
        map[mk].costs += t.amount;
      }
      map[mk].txCount++;
    });
    Object.values(map).forEach(m => { m.profit = m.revenue - m.costs; m.grossProfit = m.revenue - (m.expense || 0); m.bonusBase = m.revenue - (m.expense || 0) - (m.salary || 0); });
    return map;
  }, [transactions]);

  const sortedMonths = Object.keys(monthlyMap).sort();
  const allMonthsData = sortedMonths.map(mk => ({ key: mk, ...monthlyMap[mk] }));

  // Totals
  const totals = useMemo(() => {
    const rev = transactions.filter(t => t.type === "revenue").reduce((s, t) => s + t.amount, 0);
    const sal = transactions.filter(t => t.type === "salary").reduce((s, t) => s + t.amount, 0);
    const bon = transactions.filter(t => t.type === "bonus").reduce((s, t) => s + t.amount, 0);
    const exp = transactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { rev, sal, bon, exp, costs: sal + bon + exp, profit: rev - sal - bon - exp, grossProfit: rev - exp, bonusBase: rev - exp - sal };
  }, [transactions]);

  // Filtered transactions for table
  const tableTx = useMemo(() => {
    let list = transactions;
    if (selectedMonth !== "all") list = list.filter(t => (t.reportMonth || getMonthKey(t.date)) === selectedMonth);
    if (filter !== "all") list = list.filter(t => t.type === filter);
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, selectedMonth, filter]);

  // Month-over-month growth
  const growth = useMemo(() => {
    if (allMonthsData.length < 2) return null;
    const curr = allMonthsData[allMonthsData.length - 1];
    const prev = allMonthsData[allMonthsData.length - 2];
    const revGrowth = prev.revenue > 0 ? ((curr.revenue - prev.revenue) / prev.revenue * 100) : 0;
    const profitGrowth = prev.profit !== 0 ? ((curr.profit - prev.profit) / Math.abs(prev.profit) * 100) : 0;
    const costGrowth = prev.costs > 0 ? ((curr.costs - prev.costs) / prev.costs * 100) : 0;
    return { revGrowth, profitGrowth, costGrowth, currMonth: curr.key, prevMonth: prev.key };
  }, [allMonthsData]);

  // Chart max for scaling
  const chartMax = Math.max(...allMonthsData.map(d => Math.max(d.revenue, d.costs, Math.abs(d.profit))), 1);

  // Selected month stats
  const selStats = selectedMonth !== "all" && monthlyMap[selectedMonth] ? monthlyMap[selectedMonth] : totals;
  const selLabel = selectedMonth === "all" ? "За всё время" : getMonthLabel(selectedMonth);

  // Bonus calculation
  const rank = wm.rank || "junior";
  const selGrossProfit = selectedMonth === "all" ? totals.grossProfit : (selStats.grossProfit || 0);
  const selBonusBase = selectedMonth === "all" ? totals.bonusBase : (selStats.bonusBase || 0);
  const bonusInfo = calcBonus(rank, selBonusBase);

  return (
    <div>
      <button onClick={onBack} style={{ ...styles.btnGhost, marginBottom: 16 }}>← Назад к списку</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ ...styles.avatar, width: 56, height: 56, fontSize: 24 }}>{(wm.name || "?")[0]}</div>
          <div>
            <h1 style={{ ...styles.pageTitle, marginBottom: 2, display: "flex", alignItems: "center", gap: 10 }}>
              {wm.name}
              <span style={{ fontSize: 12, fontWeight: 700, color: RANK_COLORS[rank], background: RANK_COLORS[rank] + "18", padding: "3px 10px", borderRadius: 8 }}>{RANK_LABELS[rank]}</span>
              {wm.fired && <span style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", background: "#ef444418", padding: "3px 10px", borderRadius: 8 }}>УВОЛЕН {wm.firedDate ? String(wm.firedDate).slice(0, 10) : ""}</span>}
            </h1>
            {wm.team && <div style={{ color: "#a1a1aa" }}>{wm.team}</div>}
            {teamLeader && <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}><span style={{ fontSize: 11, color: "#71717a" }}>Тим-лидер:</span><span style={{ fontSize: 12, fontWeight: 600, color: "#c084fc", background: "#9333ea0d", padding: "2px 8px", borderRadius: 6 }}>{teamLeader.name}</span></div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && !wm.fired && <button onClick={onDeleteWm} style={{ ...styles.btnGhost, borderColor: "#ef444444", color: "#ef4444" }}>🗑 Уволить</button>}
          {canEdit && wm.fired && <button onClick={onRestoreWm} style={{ ...styles.btnGhost, borderColor: "#10b98144", color: "#10b981" }}>↩ Восстановить</button>}
          {canEdit && <button onClick={onEditWm} style={styles.btnGhost}>⚙ Настройки</button>}
          {canEdit && !wm.fired && <button onClick={onAddTx} style={styles.btnPrimary}>+ Добавить операцию</button>}
        </div>
      </div>

      {/* MONTH SELECTOR */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#71717a", fontWeight: 600, marginRight: 4 }}>Период:</span>
        <button onClick={() => setSelectedMonth("all")} style={{ ...styles.chip, ...(selectedMonth === "all" ? styles.chipActive : {}), fontSize: 12, padding: "5px 12px" }}>За всё время</button>
        {sortedMonths.map(mk => (
          <button key={mk} onClick={() => setSelectedMonth(mk)} style={{ ...styles.chip, ...(selectedMonth === mk ? styles.chipActive : {}), fontSize: 12, padding: "5px 12px" }}>
            {getMonthLabel(mk)}
          </button>
        ))}
      </div>

      {/* STAT CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
        {[
          { l: "Доход", v: selectedMonth === "all" ? totals.rev : (selStats.revenue || 0), c: "#10b981" },
          { l: "Расходники", v: selectedMonth === "all" ? totals.exp : (selStats.expense || 0), c: "#ef4444" },
          { l: "Зарплата", v: selectedMonth === "all" ? totals.sal : (selStats.salary || 0), c: "#9333ea" },
          { l: "Бонус внесён", v: selectedMonth === "all" ? totals.bon : (selStats.bonus || 0), c: "#f59e0b" },
          { l: "Профит Нетто", v: selGrossProfit, c: selGrossProfit >= 0 ? "#c084fc" : "#ef4444" },
        ].map((s, i) => (
          <div key={i} style={{ ...styles.card, textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 4 }}>{s.l}</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: s.c }}>{fmt(s.v)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ ...styles.card, textAlign: "center", padding: 16 }}>
          <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 4 }}>База для бонуса</div>
          <div style={{ fontSize: 9, color: "#52525b", marginBottom: 4 }}>Доход − Расходники − Зарплата</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: selBonusBase >= 0 ? "#c084fc" : "#ef4444" }}>{fmt(selBonusBase)}</div>
        </div>
        <div style={{ ...styles.card, textAlign: "center", padding: 16, border: `1px solid ${RANK_COLORS[rank]}44` }}>
          <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 4 }}>Бонус ({RANK_LABELS[rank]}, {bonusInfo.percent}%)</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: RANK_COLORS[rank] }}>{fmt(bonusInfo.amount)}</div>
        </div>
        {canEdit && (
          <div style={{ ...styles.card, textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 4 }}>Чистый профит</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: (selectedMonth === "all" ? totals.profit : (selStats.profit || 0)) >= 0 ? "#10b981" : "#ef4444" }}>{fmt(selectedMonth === "all" ? totals.profit : (selStats.profit || 0))}</div>
          </div>
        )}
      </div>

      {/* GROWTH BADGES */}
      {growth && selectedMonth === "all" && (
        <div style={{ ...styles.card, marginBottom: 20, padding: 16 }}>
          <h3 style={{ ...styles.cardTitle, marginBottom: 12 }}>Рост месяц к месяцу <span style={{ fontSize: 11, color: "#71717a", fontWeight: 400 }}>({getMonthLabel(growth.prevMonth)} → {getMonthLabel(growth.currMonth)})</span></h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { l: "Доход", v: growth.revGrowth },
              { l: "Profit", v: growth.profitGrowth },
              { l: "Затраты", v: growth.costGrowth },
            ].map((g, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 10, background: g.v >= 0 ? (g.l === "Затраты" ? "#ef444410" : "#10b98110") : (g.l === "Затраты" ? "#10b98110" : "#ef444410") }}>
                <span style={{ fontSize: 18, color: g.v >= 0 ? (g.l === "Затраты" ? "#ef4444" : "#10b981") : (g.l === "Затраты" ? "#10b981" : "#ef4444") }}>
                  {g.v >= 0 ? "▲" : "▼"}
                </span>
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa" }}>{g.l}</div>
                  <div style={{ fontWeight: 700, color: g.v >= 0 ? (g.l === "Затраты" ? "#ef4444" : "#10b981") : (g.l === "Затраты" ? "#10b981" : "#ef4444") }}>
                    {g.v >= 0 ? "+" : ""}{g.v.toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TABS */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {[
          { id: "analytics", label: "📊 Графики по месяцам" },
          { id: "transactions", label: "📋 Операции" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...styles.chip, padding: "8px 18px", ...(tab === t.id ? styles.chipActive : {}) }}>{t.label}</button>
        ))}
      </div>

      {/* ANALYTICS TAB */}
      {tab === "analytics" && (
        <div>
          {allMonthsData.length === 0 ? (
            <div style={{ ...styles.card, ...styles.emptyState, padding: 60 }}>Нет данных. Добавьте операции для отображения графиков.</div>
          ) : (
            <>
              {/* BAR CHART - Revenue vs Costs vs Profit */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Доход / Затраты / Профит по месяцам</h3>
                <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 200, padding: "0 8px" }}>
                  {allMonthsData.map((d) => (
                    <div key={d.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 170, width: "100%" }}>
                        <div style={{ flex: 1, background: "#10b981", borderRadius: "3px 3px 0 0", height: `${(d.revenue / chartMax) * 100}%`, minHeight: d.revenue > 0 ? 2 : 0, transition: "height 0.4s" }} title={`Revenue: ${fmt(d.revenue)}`} />
                        <div style={{ flex: 1, background: "#f59e0b", borderRadius: "3px 3px 0 0", height: `${(d.costs / chartMax) * 100}%`, minHeight: d.costs > 0 ? 2 : 0, transition: "height 0.4s" }} title={`Costs: ${fmt(d.costs)}`} />
                        {canEdit && <div style={{ flex: 1, background: d.profit >= 0 ? "#9333ea" : "#ef4444", borderRadius: "3px 3px 0 0", height: `${(Math.abs(d.profit) / chartMax) * 100}%`, minHeight: 2, transition: "height 0.4s" }} title={`Profit: ${fmt(d.profit)}`} />}
                      </div>
                      <div style={{ fontSize: 9, color: "#a1a1aa", whiteSpace: "nowrap" }}>{getMonthLabel(d.key).slice(0, 3)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 11, flexWrap: "wrap" }}>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#10b981", marginRight: 4 }}/>Доход</span>
                  <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#f59e0b", marginRight: 4 }}/>Затраты</span>
                  {canEdit && <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#9333ea", marginRight: 4 }}/>Profit</span>}
                </div>
              </div>

              {/* TREND LINE CHART */}
              {canEdit && <div style={{ ...styles.card, marginTop: 16 }}>
                <h3 style={styles.cardTitle}>Тренд профита</h3>
                {allMonthsData.length >= 2 ? (
                  <div style={{ position: "relative", height: 160, padding: "0 8px" }}>
                    <svg width="100%" height="160" viewBox={`0 0 ${allMonthsData.length * 100} 160`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
                      {(() => {
                        const profitMax = Math.max(...allMonthsData.map(d => Math.abs(d.profit)), 1);
                        const points = allMonthsData.map((d, i) => {
                          const x = allMonthsData.length === 1 ? 50 : (i / (allMonthsData.length - 1)) * (allMonthsData.length * 100 - 20) + 10;
                          const y = 140 - ((d.profit + profitMax) / (profitMax * 2)) * 120;
                          return { x, y, ...d };
                        });
                        const zeroY = 140 - ((0 + profitMax) / (profitMax * 2)) * 120;
                        const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
                        return (
                          <>
                            <line x1="0" y1={zeroY} x2={allMonthsData.length * 100} y2={zeroY} stroke="#3f3f46" strokeWidth="1" strokeDasharray="4 4" />
                            <path d={pathD} fill="none" stroke="#c084fc" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            {points.map((p, i) => (
                              <g key={i}>
                                <circle cx={p.x} cy={p.y} r="5" fill="#c084fc" stroke="#27272a" strokeWidth="2" />
                                <text x={p.x} y={p.y - 12} fill="#d4d4d8" fontSize="10" textAnchor="middle" fontWeight="600">{fmt(p.profit)}</text>
                              </g>
                            ))}
                          </>
                        );
                      })()}
                    </svg>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      {allMonthsData.map(d => <span key={d.key} style={{ fontSize: 9, color: "#71717a", flex: 1, textAlign: "center" }}>{getMonthLabel(d.key).slice(0,3)}</span>)}
                    </div>
                  </div>
                ) : (
                  <div style={styles.emptyState}>Нужно минимум 2 месяца данных для тренда</div>
                )}
              </div>}

              {/* COST BREAKDOWN PER MONTH TABLE */}
              <div style={{ ...styles.card, marginTop: 16 }}>
                <h3 style={styles.cardTitle}>Помесячная таблица</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Месяц</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Доход</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Расходники</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Зарплата</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Профит Нетто</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>База бонуса</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Бонус %</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Бонус $</th>
                        {canEdit && <th style={{ ...styles.th, textAlign: "right" }}>Чистый профит</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {allMonthsData.map(d => {
                        const mb = calcBonus(rank, d.bonusBase || 0);
                        return (
                        <tr key={d.key} style={styles.tableRow} onClick={() => { setSelectedMonth(d.key); setTab("transactions"); }}>
                          <td style={{ ...styles.td, fontWeight: 600 }}>{getMonthLabel(d.key)}</td>
                          <td style={{ ...styles.td, textAlign: "right", color: "#10b981" }}>{fmt(d.revenue)}</td>
                          <td style={{ ...styles.td, textAlign: "right", color: "#ef4444" }}>{fmt(d.expense || 0)}</td>
                          <td style={{ ...styles.td, textAlign: "right", color: "#9333ea" }}>{fmt(d.salary || 0)}</td>
                          <td style={{ ...styles.td, textAlign: "right", fontWeight: 600, color: (d.grossProfit || 0) >= 0 ? "#c084fc" : "#ef4444" }}>{fmt(d.grossProfit || 0)}</td>
                          <td style={{ ...styles.td, textAlign: "right", color: (d.bonusBase || 0) >= 0 ? "#a1a1aa" : "#ef4444" }}>{fmt(d.bonusBase || 0)}</td>
                          <td style={{ ...styles.td, textAlign: "right", color: RANK_COLORS[rank], fontWeight: 600 }}>{mb.percent}%</td>
                          <td style={{ ...styles.td, textAlign: "right", color: RANK_COLORS[rank], fontWeight: 700 }}>{fmt(mb.amount)}</td>
                          {canEdit && <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: d.profit >= 0 ? "#10b981" : "#ef4444" }}>{fmt(d.profit)}</td>}
                        </tr>
                        );
                      })}
                      <tr style={{ borderTop: "2px solid #3f3f46" }}>
                        <td style={{ ...styles.td, fontWeight: 800 }}>ИТОГО</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#10b981" }}>{fmt(totals.rev)}</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#ef4444" }}>{fmt(totals.exp)}</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#9333ea" }}>{fmt(totals.sal)}</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: totals.grossProfit >= 0 ? "#c084fc" : "#ef4444" }}>{fmt(totals.grossProfit)}</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: totals.bonusBase >= 0 ? "#a1a1aa" : "#ef4444" }}>{fmt(totals.bonusBase)}</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: RANK_COLORS[rank] }}>{bonusInfo.percent}%</td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: RANK_COLORS[rank] }}>{fmt(bonusInfo.amount)}</td>
                        {canEdit && <td style={{ ...styles.td, textAlign: "right", fontWeight: 800, color: totals.profit >= 0 ? "#10b981" : "#ef4444" }}>{fmt(totals.profit)}</td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: "#52525b", marginTop: 8 }}>Нажмите на месяц чтобы увидеть транзакции</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TRANSACTIONS TAB */}
      {tab === "transactions" && (
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Операции — {selLabel}</h3>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {["all", "revenue", "salary", "bonus", "expense"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{ ...styles.chip, ...(filter === f ? styles.chipActive : {}), fontSize: 12, padding: "5px 12px" }}>
                {f === "all" ? "Все" : (TYPE_LABELS[f] || f)}
              </button>
            ))}
          </div>
          {tableTx.length === 0 ? (
            <div style={styles.emptyState}>Нет транзакций за этот период</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Дата внесения</th>
                  <th style={styles.th}>Отчётный месяц</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Описание</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Сумма</th>
                  {canEdit && <th style={{ ...styles.th, width: 70 }} />}
                </tr>
              </thead>
              <tbody>
                {tableTx.map((tx) => (
                  <tr key={tx.id} style={styles.tableRow}>
                    <td style={styles.td}>{tx.date ? String(tx.date).slice(0, 10) : ""}</td>
                    <td style={styles.td}><span style={{ background: "#9333ea0d", padding: "2px 8px", borderRadius: 6, fontSize: 12, color: "#c084fc" }}>{tx.reportMonth ? getMonthLabel(tx.reportMonth) : getMonthLabel(getMonthKey(tx.date))}</span></td>
                    <td style={styles.td}><span style={{ ...styles.typeBadge, ...typeBadgeColor(tx.type) }}>{TYPE_LABELS[tx.type] || tx.type}</span></td>
                    <td style={styles.td}>{tx.description || "—"}</td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: tx.type === "revenue" ? "#10b981" : "#ef4444" }}>
                      {tx.type === "revenue" ? "+" : "−"}{fmt(tx.amount)}
                    </td>
                    {canEdit && (
                      <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => onEditTx(tx)} style={styles.editBtn} title="Edit">✎</button>
                          <button onClick={() => onDeleteTx(tx.id)} style={styles.deleteBtn} title="Delete">×</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== TRANSACTIONS VIEW ====================
function TransactionsView({ transactions, webmasters, canEdit, onAddTx, onEditTx, onDeleteTx }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? transactions : transactions.filter((t) => t.type === filter);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ ...styles.pageTitle, marginBottom: 0 }}>Все транзакции</h1>
        {canEdit && webmasters.length > 0 && <button onClick={onAddTx} style={styles.btnPrimary}>+ Добавить операцию</button>}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["all", "revenue", "salary", "bonus", "expense"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...styles.chip, ...(filter === f ? styles.chipActive : {}) }}>
            {f === "all" ? "Все" : (TYPE_LABELS[f] || f)} ({f === "all" ? transactions.length : transactions.filter(t => t.type === f).length})
          </button>
        ))}
      </div>

      <div style={styles.card}>
        {sorted.length === 0 ? (
          <div style={styles.emptyState}>Транзакций не найдено</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Дата внесения</th>
                <th style={styles.th}>Отчётный месяц</th>
                <th style={styles.th}>Вебмастер</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Описание</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Сумма</th>
                {canEdit && <th style={{ ...styles.th, width: 70 }} />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((tx) => {
                const wm = webmasters.find((w) => w.id === tx.wmId);
                return (
                  <tr key={tx.id} style={styles.tableRow}>
                    <td style={styles.td}>{tx.date ? String(tx.date).slice(0, 10) : ""}</td>
                    <td style={styles.td}><span style={{ background: "#9333ea0d", padding: "2px 8px", borderRadius: 6, fontSize: 12, color: "#c084fc" }}>{tx.reportMonth ? getMonthLabel(tx.reportMonth) : getMonthLabel(getMonthKey(tx.date))}</span></td>
                    <td style={styles.td}><span style={{ fontWeight: 600 }}>{wm ? wm.name : "?"}</span></td>
                    <td style={styles.td}><span style={{ ...styles.typeBadge, ...typeBadgeColor(tx.type) }}>{TYPE_LABELS[tx.type] || tx.type}</span></td>
                    <td style={styles.td}>{tx.description || "—"}</td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: tx.type === "revenue" ? "#10b981" : "#ef4444" }}>
                      {tx.type === "revenue" ? "+" : "−"}{fmt(tx.amount)}
                    </td>
                    {canEdit && (
                      <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => onEditTx(tx)} style={styles.editBtn} title="Edit">✎</button>
                          <button onClick={() => onDeleteTx(tx.id)} style={styles.deleteBtn} title="Delete">×</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ==================== USERS VIEW ====================
function UsersView({ data, updateData, showToast, addLog }) {
  const [form, setForm] = useState({ name: "", login: "", role: "finance", pin: "" });
  const [editUser, setEditUser] = useState(null);

  const addUser = () => {
    if (!form.name || !form.login.trim() || !form.pin) return;
    updateData((d) => {
      d.users.push({ id: uid(), name: form.name, login: form.login.trim().toLowerCase(), role: form.role, pin: form.pin });
    });
    addLog("user_added", `Добавлен "${form.name}" (${form.role})`);
    setForm({ name: "", login: "", role: "finance", pin: "" });
    showToast("Пользователь добавлен");
  };

  const deleteUser = (id) => {
    if (id === "admin1") return showToast("Нельзя удалить главного админа", "error");
    const user = data.users.find(u => u.id === id);
    updateData((d) => { d.users = d.users.filter((u) => u.id !== id); });
    addLog("user_deleted", `Удалён "${user?.name || "?"}"`);
    showToast("Пользователь удалён");
  };

  const saveEditUser = () => {
    if (!editUser || !editUser.name) return;
    const old = data.users.find(u => u.id === editUser.id);
    const changes = [];
    if (old.name !== editUser.name) changes.push(`имя: ${old.name} → ${editUser.name}`);
    if (old.login !== editUser.login) changes.push(`логин: ${old.login} → ${editUser.login}`);
    if (old.pin !== editUser.pin) changes.push("пароль изменён");
    updateData((d) => {
      const idx = d.users.findIndex(u => u.id === editUser.id);
      if (idx !== -1) d.users[idx] = { ...d.users[idx], name: editUser.name, login: editUser.login.trim().toLowerCase(), pin: editUser.pin };
    });
    addLog("user_edited", `Изменён "${editUser.name}": ${changes.join(", ") || "без изменений"}`);
    setEditUser(null);
    showToast("Пользователь обновлён");
  };

  return (
    <div>
      <h1 style={styles.pageTitle}>Пользователи</h1>
      <div style={{ padding: "10px 14px", background: "#f59e0b10", border: "1px solid #f59e0b33", borderRadius: 10, fontSize: 12, color: "#f59e0b", marginBottom: 20 }}>
        🔒 Пароли хешируются и хранятся в зашифрованном виде. Сброс пароля — через это поле.
      </div>

      {/* ADMIN & FINANCE */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Администраторы и фин. менеджеры</h3>
        <div style={{ display: "grid", gap: 12 }}>
          {data.users.map((u) => (
            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: "#09090b", borderRadius: 12, flexWrap: "wrap" }}>
              <div style={{ ...styles.avatar, width: 38, height: 38, fontSize: 14, background: u.role === "admin" ? "linear-gradient(135deg, #9333ea, #7c3aed)" : "linear-gradient(135deg, #f59e0b, #d97706)" }}>{(u.name || "?")[0]}</div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name}</div>
                <div style={{ fontSize: 12, color: "#71717a" }}>{u.role === "admin" ? "Администратор" : "Фин. менеджер"}</div>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#a1a1aa", flexWrap: "wrap" }}>
                <div><span style={{ color: "#71717a" }}>Логин: </span><span style={{ fontFamily: "monospace", color: "#c084fc" }}>{u.login || "—"}</span></div>
                <div><span style={{ color: "#71717a" }}>Пароль: </span><span style={{ fontFamily: "monospace" }}>••••••••</span></div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setEditUser({ ...u })} style={styles.editBtn} title="Изменить">✎</button>
                {u.id !== "admin1" && <button onClick={() => deleteUser(u.id)} style={styles.deleteBtn} title="Удалить">×</button>}
              </div>
            </div>
          ))}
        </div>

        {/* ADD NEW USER */}
        <div style={{ marginTop: 16, padding: 16, background: "#09090b", borderRadius: 12, border: "1px dashed #3f3f46" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#71717a", marginBottom: 10 }}>Добавить пользователя</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={styles.formLabel}>Имя</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={styles.input} placeholder="Полное имя" />
            </div>
            <div>
              <label style={styles.formLabel}>Логин</label>
              <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value.replace(/\s/g, "") })} style={styles.input} placeholder="Без пробелов" />
            </div>
            <div>
              <label style={styles.formLabel}>Пароль</label>
              <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} style={styles.input} placeholder="Пароль" type="password" />
            </div>
            <div>
              <label style={styles.formLabel}>Роль</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={styles.input}>
                <option value="finance">Фин. менеджер</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
          </div>
          <button onClick={addUser} disabled={!form.name || !form.login.trim() || !form.pin} style={{ ...styles.btnPrimary, marginTop: 12, width: "100%", opacity: (form.name && form.login.trim() && form.pin) ? 1 : 0.5 }}>Добавить</button>
        </div>
      </div>

      {/* WEBMASTER ACCOUNTS */}
      <div style={{ ...styles.card, marginTop: 20 }}>
        <h3 style={styles.cardTitle}>Аккаунты вебмастеров</h3>
        <p style={{ color: "#71717a", fontSize: 12, marginBottom: 12 }}>Управление логинами и паролями через Настройки вебмастера</p>
        {data.webmasters.length === 0 ? (
          <div style={styles.emptyState}>Вебмастеров пока нет</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {data.webmasters.map((wm) => (
              <div key={wm.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "#09090b", borderRadius: 10, opacity: wm.fired ? 0.5 : 1 }}>
                <div style={{ ...styles.avatar, width: 32, height: 32, fontSize: 12, ...(wm.fired ? { background: "#52525b" } : {}) }}>{(wm.name || "?")[0]}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{wm.name}</div>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#a1a1aa" }}>
                  <span><span style={{ color: "#71717a" }}>Логин: </span><span style={{ fontFamily: "monospace", color: "#c084fc" }}>{wm.login || "—"}</span></span>
                  <span><span style={{ color: "#71717a" }}>Класс: </span><span style={{ color: RANK_COLORS[wm.rank || "junior"], fontWeight: 600 }}>{RANK_LABELS[wm.rank || "junior"]}</span></span>
                </div>
                {wm.fired && <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>УВОЛЕН</span>}
                {!wm.fired && <span style={{ fontSize: 10, color: "#10b981" }}>●</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* EDIT USER MODAL */}
      {editUser && (
        <Modal title="Редактирование пользователя" onClose={() => setEditUser(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ padding: "10px 14px", background: "#9333ea0d", borderRadius: 10, fontSize: 13, color: "#c084fc" }}>
              {editUser.role === "admin" ? "Администратор" : "Фин. менеджер"}: <strong>{editUser.name}</strong>
            </div>
            <div>
              <label style={styles.formLabel}>Имя</label>
              <input value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} style={styles.input} />
            </div>
            <div>
              <label style={styles.formLabel}>Логин</label>
              <input value={editUser.login || ""} onChange={(e) => setEditUser({ ...editUser, login: e.target.value.replace(/\s/g, "") })} style={styles.input} placeholder="Без пробелов" />
            </div>
            <div>
              <label style={styles.formLabel}>Пароль</label>
              <input value={editUser.pin} onChange={(e) => setEditUser({ ...editUser, pin: e.target.value })} style={styles.input} type="password" placeholder="Новый пароль" />
            </div>
            <button onClick={saveEditUser} disabled={!editUser.name || !editUser.pin} style={{ ...styles.btnPrimary, opacity: (editUser.name && editUser.pin) ? 1 : 0.5 }}>Сохранить</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ==================== TEAM LEADERS VIEW ====================
function TeamLeadersView({ teamLeaders, webmasters, transactions, canEdit, updateData, addLog, showToast, reloadData, onSelectWm }) {
  const [newName, setNewName] = useState("");
  const [newTlLogin, setNewTlLogin] = useState("");
  const [newTlPin, setNewTlPin] = useState("");
  const [expandedTl, setExpandedTl] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [confirmDeleteTl, setConfirmDeleteTl] = useState(null);
  const [editTl, setEditTl] = useState(null);

  const addTl = async () => {
    if (!newName.trim() || !newTlLogin.trim()) return;
    try {
      await api.createTeamLeader({ name: newName.trim(), login: newTlLogin.trim().toLowerCase(), password: newTlPin || "0000" });
      await reloadData();
      addLog("tl_added", `Добавлен тим-лидер "${newName.trim()}"`);
      setNewName(""); setNewTlLogin(""); setNewTlPin("");
      showToast("Тим-лидер добавлен");
    } catch(e) {
      showToast("Ошибка: " + e.message, "error");
    }
  };

  const deleteTl = async (id) => {
    const tl = teamLeaders.find(t => t.id === id);
    try {
      await api.deleteTeamLeader(id);
      await reloadData();
      addLog("tl_deleted", `Removed team leader "${tl?.name || "?"}"`);
      showToast("Тим-лидер удалён");
      if (expandedTl === id) setExpandedTl(null);
    } catch(e) {
      showToast("Ошибка: " + e.message, "error");
    }
  };

  const TL_BONUS_PCT = 8;

  // Compute stats per TL
  const tlStats = useMemo(() => {
    return teamLeaders.map(tl => {
      const tlWms = webmasters.filter(w => w.teamLeaderId === tl.id);
      const wmIds = new Set(tlWms.map(w => w.id));
      const tlTx = transactions.filter(t => wmIds.has(t.wmId));

      const rev = tlTx.filter(t => t.type === "revenue").reduce((s, t) => s + t.amount, 0);
      const costs = tlTx.filter(t => t.type !== "revenue").reduce((s, t) => s + t.amount, 0);
      const expenses = tlTx.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      const salary = tlTx.filter(t => t.type === "salary").reduce((s, t) => s + t.amount, 0);
      const bonusBase = rev - expenses - salary;
      const tlBonus = bonusBase > 0 ? Math.round(bonusBase * TL_BONUS_PCT / 100) : 0;

      // Monthly
      const monthlyMap = {};
      tlTx.forEach(t => {
        const mk = t.reportMonth || getMonthKey(t.date);
        if (!monthlyMap[mk]) monthlyMap[mk] = { revenue: 0, costs: 0, expenses: 0, salary: 0 };
        if (t.type === "revenue") monthlyMap[mk].revenue += t.amount;
        else monthlyMap[mk].costs += t.amount;
        if (t.type === "expense") monthlyMap[mk].expenses += t.amount;
        if (t.type === "salary") monthlyMap[mk].salary += t.amount;
      });
      const monthly = Object.entries(monthlyMap).sort(([a],[b]) => a.localeCompare(b)).map(([key, d]) => {
        const bb = d.revenue - d.expenses - d.salary;
        return { key, ...d, profit: d.revenue - d.costs, grossProfit: d.revenue - d.expenses, bonusBase: bb, tlBonus: bb > 0 ? Math.round(bb * TL_BONUS_PCT / 100) : 0 };
      });

      // Per-webmaster stats
      const wmStats = tlWms.map(w => {
        const wTx = transactions.filter(t => t.wmId === w.id);
        const wRev = wTx.filter(t => t.type === "revenue").reduce((s, t) => s + t.amount, 0);
        const wCost = wTx.filter(t => t.type !== "revenue").reduce((s, t) => s + t.amount, 0);
        const wExp = wTx.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
        return { ...w, revenue: wRev, costs: wCost, grossProfit: wRev - wExp, profit: wRev - wCost };
      }).sort((a, b) => b.profit - a.profit);

      return { ...tl, wmCount: tlWms.length, rev, costs, expenses, salary, grossProfit: rev - expenses, bonusBase, tlBonus, profit: rev - costs, monthly, wmStats };
    }).sort((a, b) => b.profit - a.profit);
  }, [teamLeaders, webmasters, transactions]);

  // All months across all TLs
  const allMonths = useMemo(() => {
    const set = new Set();
    tlStats.forEach(tl => tl.monthly.forEach(m => set.add(m.key)));
    return [...set].sort();
  }, [tlStats]);

  return (
    <div>
      {/* ── ЗАГОЛОВОК ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ ...styles.pageTitle, marginBottom: 0 }}>Тим-лидеры</h1>
        {teamLeaders.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#52525b", background: "#27272a", padding: "4px 12px", borderRadius: 20, border: "1px solid #3f3f46" }}>
              {teamLeaders.length} {teamLeaders.length === 1 ? "тим-лидер" : teamLeaders.length < 5 ? "тим-лидера" : "тим-лидеров"}
            </span>
          </div>
        )}
      </div>

      {/* ── ФОРМА ДОБАВЛЕНИЯ ── */}
      {canEdit && (
        <div style={{ ...styles.card, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fafafa", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: "#9333ea22", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#c084fc" }}>+</span>
            Добавить тим-лидера
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={styles.formLabel}>Имя *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addTl()}
                style={styles.input}
                placeholder="Имя тим-лидера"
              />
            </div>
            <div>
              <label style={styles.formLabel}>Логин *</label>
              <input
                value={newTlLogin}
                onChange={e => setNewTlLogin(e.target.value.replace(/\s/g, ""))}
                onKeyDown={e => e.key === "Enter" && addTl()}
                style={styles.input}
                placeholder="Без пробелов"
              />
            </div>
            <div>
              <label style={styles.formLabel}>Пароль</label>
              <input
                value={newTlPin}
                onChange={e => setNewTlPin(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addTl()}
                style={styles.input}
                placeholder="Пароль"
                type="password"
              />
            </div>
          </div>
          <button
            onClick={addTl}
            disabled={!newName.trim() || !newTlLogin.trim()}
            style={{ ...styles.btnPrimary, opacity: (newName.trim() && newTlLogin.trim()) ? 1 : 0.5 }}
          >
            + Добавить тим-лидера
          </button>
        </div>
      )}

      {/* ── ПУСТОЕ СОСТОЯНИЕ ── */}
      {teamLeaders.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", padding: "60px 40px" }}>
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>◐</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#71717a", marginBottom: 6 }}>Тим-лидеров пока нет</div>
          <div style={{ fontSize: 13, color: "#52525b" }}>Заполните форму выше и назначьте вебмастеров</div>
        </div>
      ) : (
        <>
          {/* ── КАРТОЧКИ ТЛ ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tlStats.map(tl => {
              const isOpen = expandedTl === tl.id;
              const chartMax = Math.max(...tl.monthly.map(m => Math.max(m.revenue, m.costs, Math.abs(m.profit))), 1);
              return (
                <div key={tl.id} style={{ background: "#18181b", borderRadius: 16, border: "1px solid #27272a", overflow: "hidden" }}>

                  {/* ── ШАПКА КАРТОЧКИ ── */}
                  <div
                    onClick={() => setExpandedTl(isOpen ? null : tl.id)}
                    style={{ padding: "16px 20px", cursor: "pointer", userSelect: "none" }}
                  >
                    {/* Строка 1: аватар + имя + бейджи + кнопки */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                      <div style={{ ...styles.avatar, width: 42, height: 42, fontSize: 17, background: "linear-gradient(135deg, #c026d3, #9333ea)", flexShrink: 0 }}>
                        {(tl.name || "?")[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: "#fafafa" }}>{tl.name}</div>
                        <div style={{ fontSize: 11, color: "#52525b", fontFamily: "monospace", marginTop: 1 }}>{tl.login || "—"}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span style={{ padding: "3px 10px", borderRadius: 20, background: "#9333ea18", color: "#c084fc", fontSize: 12, fontWeight: 600 }}>
                          {tl.wmCount} {tl.wmCount === 1 ? "веб" : "вебов"}
                        </span>
                        {canEdit && (
                          <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => setEditTl({ id: tl.id, name: tl.name, login: tl.login || "", pin: "" })}
                              style={styles.editBtn}
                              title="Редактировать"
                            >✎</button>
                            <button
                              onClick={() => setConfirmDeleteTl(tl.id)}
                              style={styles.deleteBtn}
                              title="Удалить"
                            >×</button>
                          </div>
                        )}
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, background: "#27272a",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#71717a", fontSize: 11,
                          transition: "transform 0.2s",
                          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)"
                        }}>▼</div>
                      </div>
                    </div>

                    {/* Строка 2: финансовые метрики */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1, background: "#27272a", borderRadius: 10, overflow: "hidden" }}>
                      {[
                        { label: "Доход", val: tl.rev, color: "#10b981" },
                        { label: "Расходники", val: tl.expenses, color: "#ef4444" },
                        { label: "Зарплаты", val: tl.salary, color: "#9333ea" },
                        { label: "База бонуса", val: tl.bonusBase, color: tl.bonusBase >= 0 ? "#a1a1aa" : "#ef4444" },
                        { label: "Бонус TL (8%)", val: tl.tlBonus, color: "#c084fc" },
                        { label: "Чистый профит", val: tl.profit, color: tl.profit >= 0 ? "#10b981" : "#ef4444", highlight: true },
                      ].map((s, i) => (
                        <div key={i} style={{
                          padding: "10px 12px",
                          background: s.highlight ? (tl.profit >= 0 ? "#10b98110" : "#ef444410") : "#18181b",
                        }}>
                          <div style={{ fontSize: 10, color: "#52525b", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                          <div style={{ fontSize: 13, fontWeight: s.highlight ? 800 : 700, color: s.color, whiteSpace: "nowrap" }}>{fmt(s.val)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── РАСКРЫТАЯ ЧАСТЬ ── */}
                  {isOpen && (
                    <div style={{ borderTop: "1px solid #27272a", padding: "20px 20px 24px", background: "#0f0f11" }}>

                      {/* KPI плашки */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
                        {[
                          { label: "Доход вебов", val: tl.rev, color: "#10b981", bg: "#10b98112" },
                          { label: "Расходники + ЗП", val: tl.expenses + tl.salary, color: "#ef4444", bg: "#ef444410" },
                          { label: "База бонуса TL", val: tl.bonusBase, color: tl.bonusBase >= 0 ? "#c084fc" : "#ef4444", bg: "#9333ea0a" },
                          { label: "Бонус TL (8%)", val: tl.tlBonus, color: "#c084fc", bg: "#c084fc10", border: "1px solid #a855f730" },
                        ].map((s, i) => (
                          <div key={i} style={{ background: s.bg, borderRadius: 12, padding: "14px 16px", border: s.border || "1px solid #27272a" }}>
                            <div style={{ fontSize: 11, color: "#71717a", marginBottom: 6 }}>{s.label}</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, letterSpacing: -0.5 }}>{fmt(s.val)}</div>
                          </div>
                        ))}
                      </div>

                      {/* График + таблица бонуса по месяцам */}
                      {tl.monthly.length > 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
                          {/* График */}
                          <div style={{ background: "#18181b", borderRadius: 12, padding: "16px", border: "1px solid #27272a" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.8 }}>Динамика по месяцам</div>
                            <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 110 }}>
                              {tl.monthly.map(d => (
                                <div key={d.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0 }}>
                                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 84, width: "100%" }}>
                                    <div style={{ flex: 1, background: "#10b981", borderRadius: "3px 3px 0 0", height: `${(d.revenue / chartMax) * 100}%`, minHeight: d.revenue > 0 ? 2 : 0 }} title={`Доход: ${fmt(d.revenue)}`} />
                                    <div style={{ flex: 1, background: "#f59e0b", borderRadius: "3px 3px 0 0", height: `${(d.costs / chartMax) * 100}%`, minHeight: d.costs > 0 ? 2 : 0 }} title={`Затраты: ${fmt(d.costs)}`} />
                                    <div style={{ flex: 1, background: d.profit >= 0 ? "#9333ea" : "#ef4444", borderRadius: "3px 3px 0 0", height: `${(Math.abs(d.profit) / chartMax) * 100}%`, minHeight: 2 }} title={`Профит: ${fmt(d.profit)}`} />
                                  </div>
                                  <div style={{ fontSize: 9, color: "#52525b", textAlign: "center" }}>{getMonthLabel(d.key).slice(0, 3)}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 10, color: "#52525b" }}>
                              {[["#10b981","Доход"],["#f59e0b","Затраты"],["#9333ea","Профит"]].map(([c,l]) => (
                                <span key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }}/>
                                  {l}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Таблица бонуса */}
                          <div style={{ background: "#18181b", borderRadius: 12, padding: "16px", border: "1px solid #27272a" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.8 }}>Бонус по месяцам</div>
                            <table style={{ ...styles.table, fontSize: 12, width: "100%" }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...styles.th, fontSize: 10 }}>Месяц</th>
                                    <th style={{ ...styles.th, textAlign: "right", fontSize: 10 }}>Доход</th>
                                    <th style={{ ...styles.th, textAlign: "right", fontSize: 10 }}>Расх.</th>
                                    <th style={{ ...styles.th, textAlign: "right", fontSize: 10 }}>ЗП</th>
                                    <th style={{ ...styles.th, textAlign: "right", fontSize: 10 }}>База</th>
                                    <th style={{ ...styles.th, textAlign: "right", fontSize: 10, color: "#c084fc" }}>Бонус</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tl.monthly.map(m => (
                                    <tr key={m.key}>
                                      <td style={{ ...styles.td, fontWeight: 600, fontSize: 12, padding: "8px 12px" }}>{getMonthLabel(m.key)}</td>
                                      <td style={{ ...styles.td, textAlign: "right", color: "#10b981", fontSize: 12, padding: "8px 12px" }}>{fmt(m.revenue)}</td>
                                      <td style={{ ...styles.td, textAlign: "right", color: "#ef4444", fontSize: 12, padding: "8px 12px" }}>{fmt(m.expenses)}</td>
                                      <td style={{ ...styles.td, textAlign: "right", color: "#9333ea", fontSize: 12, padding: "8px 12px" }}>{fmt(m.salary)}</td>
                                      <td style={{ ...styles.td, textAlign: "right", color: m.bonusBase >= 0 ? "#71717a" : "#ef4444", fontSize: 12, padding: "8px 12px" }}>{fmt(m.bonusBase)}</td>
                                      <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#c084fc", fontSize: 12, padding: "8px 12px" }}>{fmt(m.tlBonus)}</td>
                                    </tr>
                                  ))}
                                  <tr style={{ borderTop: "2px solid #3f3f46" }}>
                                    <td style={{ ...styles.td, fontWeight: 700, fontSize: 12, padding: "8px 12px" }}>Итого</td>
                                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#10b981", fontSize: 12, padding: "8px 12px" }}>{fmt(tl.rev)}</td>
                                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#ef4444", fontSize: 12, padding: "8px 12px" }}>{fmt(tl.expenses)}</td>
                                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#9333ea", fontSize: 12, padding: "8px 12px" }}>{fmt(tl.salary)}</td>
                                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: tl.bonusBase >= 0 ? "#71717a" : "#ef4444", fontSize: 12, padding: "8px 12px" }}>{fmt(tl.bonusBase)}</td>
                                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 800, color: "#c084fc", fontSize: 12, padding: "8px 12px" }}>{fmt(tl.tlBonus)}</td>
                                  </tr>
                                </tbody>
                              </table>
                          </div>
                        </div>
                      )}

                      {/* Таблица вебмастеров */}
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#71717a", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.8 }}>
                          Вебмастера · {tl.wmStats.length} чел.
                        </div>
                        {tl.wmStats.length === 0 ? (
                          <div style={{ padding: "24px", background: "#18181b", borderRadius: 10, textAlign: "center", color: "#52525b", fontSize: 13, border: "1px solid #27272a" }}>
                            Нет вебмастеров у этого тим-лидера
                          </div>
                        ) : (
                          <div style={{ background: "#18181b", borderRadius: 12, border: "1px solid #27272a", overflow: "hidden" }}>
                            <table style={{ ...styles.table }}>
                              <thead>
                                <tr style={{ background: "#09090b" }}>
                                  <th style={styles.th}>Вебмастер</th>
                                  <th style={{ ...styles.th, textAlign: "right" }}>Доход</th>
                                  <th style={{ ...styles.th, textAlign: "right" }}>Затраты</th>
                                  <th style={{ ...styles.th, textAlign: "right" }}>Профит Нетто</th>
                                  <th style={{ ...styles.th, textAlign: "right" }}>Чистый профит</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tl.wmStats.map(w => (
                                  <tr
                                    key={w.id}
                                    style={styles.tableRow}
                                    onClick={() => onSelectWm(w)}
                                  >
                                    <td style={styles.td}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <div style={{ ...styles.avatar, width: 30, height: 30, fontSize: 12 }}>{(w.name || "?")[0]}</div>
                                        <div>
                                          <div style={{ fontWeight: 600, fontSize: 13 }}>{w.name}</div>
                                          {w.team && <div style={{ fontSize: 11, color: "#52525b" }}>{w.team}</div>}
                                        </div>
                                      </div>
                                    </td>
                                    <td style={{ ...styles.td, textAlign: "right", color: "#10b981", fontWeight: 600 }}>{fmt(w.revenue)}</td>
                                    <td style={{ ...styles.td, textAlign: "right", color: "#f59e0b" }}>{fmt(w.costs)}</td>
                                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 600, color: w.grossProfit >= 0 ? "#c084fc" : "#ef4444" }}>{fmt(w.grossProfit)}</td>
                                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: w.profit >= 0 ? "#10b981" : "#ef4444" }}>{fmt(w.profit)}</td>
                                  </tr>
                                ))}
                                <tr style={{ borderTop: "2px solid #27272a", background: "#09090b" }}>
                                  <td style={{ ...styles.td, fontWeight: 700, color: "#a1a1aa" }}>Итого</td>
                                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#10b981" }}>{fmt(tl.rev)}</td>
                                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: "#f59e0b" }}>{fmt(tl.costs)}</td>
                                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, color: tl.grossProfit >= 0 ? "#c084fc" : "#ef4444" }}>{fmt(tl.grossProfit)}</td>
                                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 800, color: tl.profit >= 0 ? "#10b981" : "#ef4444" }}>{fmt(tl.profit)}</td>
                                </tr>
                              </tbody>
                            </table>
                            <div style={{ padding: "8px 14px", fontSize: 11, color: "#3f3f46" }}>
                              Нажмите на вебмастера для детальной аналитики
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── БЕЗ ТИМ-ЛИДЕРА ── */}
          {(() => {
            const unassigned = webmasters.filter(w => !w.teamLeaderId || !teamLeaders.find(tl => tl.id === w.teamLeaderId));
            if (unassigned.length === 0) return null;
            const uRev = transactions.filter(t => unassigned.some(w => w.id === t.wmId) && t.type === "revenue").reduce((s, t) => s + t.amount, 0);
            const uCost = transactions.filter(t => unassigned.some(w => w.id === t.wmId) && t.type !== "revenue").reduce((s, t) => s + t.amount, 0);
            return (
              <div style={{ marginTop: 10, background: "#18181b", borderRadius: 16, border: "1px solid #3f3f46", borderLeft: "3px solid #52525b", padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#71717a" }}>Без тим-лидера</span>
                    <span style={{ fontSize: 12, color: "#3f3f46", background: "#27272a", padding: "2px 8px", borderRadius: 10 }}>{unassigned.length}</span>
                  </div>
                  <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
                    <span><span style={{ color: "#52525b", fontSize: 11 }}>Доход </span><span style={{ fontWeight: 700, color: "#10b981" }}>{fmt(uRev)}</span></span>
                    <span><span style={{ color: "#52525b", fontSize: 11 }}>Затраты </span><span style={{ fontWeight: 700, color: "#f59e0b" }}>{fmt(uCost)}</span></span>
                    <span><span style={{ color: "#52525b", fontSize: 11 }}>Профит </span><span style={{ fontWeight: 700, color: uRev - uCost >= 0 ? "#10b981" : "#ef4444" }}>{fmt(uRev - uCost)}</span></span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {unassigned.map(w => (
                    <span
                      key={w.id}
                      onClick={() => onSelectWm(w)}
                      style={{ padding: "5px 12px", borderRadius: 8, background: "#27272a", border: "1px solid #3f3f46", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#a1a1aa" }}
                    >
                      {w.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* CONFIRM DELETE TL */}
      {confirmDeleteTl && (() => {
        const tl = teamLeaders.find(t => t.id === confirmDeleteTl);
        if (!tl) return null;
        const affectedWms = webmasters.filter(w => w.teamLeaderId === confirmDeleteTl);
        return (
          <div style={styles.modalOverlay} onClick={() => setConfirmDeleteTl(null)}>
            <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Fire Тим-лидер</h2>
                <button onClick={() => setConfirmDeleteTl(null)} style={styles.deleteBtn}>×</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ padding: 16, background: "#ef444410", borderRadius: 12, border: "1px solid #ef444433" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>Remove {tl.name}?</div>
                  <div style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.6 }}>
                    {affectedWms.length > 0
                      ? `${affectedWms.length} webmaster(s) станут без тим-лидера: ${affectedWms.map(w => w.name).join(", ")}. Их транзакции сохранятся.`
                      : "У этого тим-лидера нет вебмастеров. Данные не пострадают."
                    }
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setConfirmDeleteTl(null)} style={{ ...styles.btnGhost, flex: 1 }}>Cancel</button>
                  <button onClick={() => { deleteTl(confirmDeleteTl); setConfirmDeleteTl(null); }} style={{ ...styles.btnPrimary, flex: 1, background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>
                    Подтвердить удаление
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* EDIT TL MODAL */}
      {editTl && (
        <Modal title="Редактирование тим-лидера" onClose={() => setEditTl(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={styles.formLabel}>Имя</label>
              <input value={editTl.name} onChange={(e) => setEditTl({ ...editTl, name: e.target.value })} style={styles.input} />
            </div>
            <div>
              <label style={styles.formLabel}>Логин</label>
              <input value={editTl.login} onChange={(e) => setEditTl({ ...editTl, login: e.target.value.replace(/\s/g, "") })} style={styles.input} placeholder="Без пробелов" />
            </div>
            <div>
              <label style={styles.formLabel}>Пароль</label>
              <input value={editTl.pin} onChange={(e) => setEditTl({ ...editTl, pin: e.target.value })} style={styles.input} type="password" placeholder="Новый пароль (оставьте пустым — без изменений)" />
            </div>
            <button onClick={async () => {
              if (!editTl.name) return;
              const old = teamLeaders.find(t => t.id === editTl.id);
              const changes = [];
              if (old.name !== editTl.name) changes.push(`имя: ${old.name} → ${editTl.name}`);
              if ((old.pin || "") !== editTl.pin) changes.push("пароль изменён");
              try {
                const updatePayload = { name: editTl.name };
                if (editTl.pin) updatePayload.password = editTl.pin;
                await api.updateTeamLeader(editTl.id, updatePayload);
                await reloadData();
                addLog("tl_edited", `Изменён тим-лидер "${editTl.name}": ${changes.join(", ") || "без изменений"}`);
                setEditTl(null);
                showToast("Тим-лидер обновлён");
              } catch(e) {
                showToast("Ошибка: " + e.message, "error");
              }
            }} disabled={!editTl.name} style={{ ...styles.btnPrimary, opacity: editTl.name ? 1 : 0.5 }}>Сохранить</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function AddWebmasterForm({ data, onSave }) {
  const [f, setF] = useState({ name: "", team: "", pin: "", login: "", teamLeaderId: "", rank: "junior" });
  const teamLeaders = data.teamLeaders || [];
  const handleSave = () => {
    if (!f.name || !f.login.trim()) return;
    const userId = `wm_${uid()}`;
    onSave({ id: uid(), name: f.name, team: f.team, userId, login: f.login.trim().toLowerCase(), pin: f.pin || "0000", teamLeaderId: f.teamLeaderId || null, rank: f.rank });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={styles.formLabel}>Имя *</label>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={styles.input} placeholder="Имя вебмастера" autoFocus />
      </div>
      <div>
        <label style={styles.formLabel}>Логин *</label>
        <input value={f.login} onChange={(e) => setF({ ...f, login: e.target.value.replace(/\s/g, "") })} style={styles.input} placeholder="Логин для входа (без пробелов)" />
      </div>
      <div>
        <label style={styles.formLabel}>Пароль</label>
        <input value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} style={styles.input} placeholder="Пароль для входа" type="password" />
      </div>
      <div>
        <label style={styles.formLabel}>Класс *</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {WM_RANKS.map(r => (
            <button key={r} onClick={() => setF({ ...f, rank: r })} type="button" style={{ padding: "8px 4px", borderRadius: 8, border: f.rank === r ? `2px solid ${RANK_COLORS[r]}` : "1px solid #27272a", background: f.rank === r ? RANK_COLORS[r] + "18" : "transparent", color: f.rank === r ? RANK_COLORS[r] : "#a1a1aa", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
              {RANK_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={styles.formLabel}>Команда / Проект</label>
        <input value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} style={styles.input} placeholder="Название команды" />
      </div>
      <div>
        <label style={styles.formLabel}>Тим-лидер</label>
        <select value={f.teamLeaderId} onChange={(e) => setF({ ...f, teamLeaderId: e.target.value })} style={styles.input}>
          <option value="">— Без тим-лидера —</option>
          {teamLeaders.map(tl => <option key={tl.id} value={tl.id}>{tl.name}</option>)}
        </select>
      </div>
      <button onClick={handleSave} disabled={!f.name || !f.login.trim()} style={{ ...styles.btnPrimary, opacity: (f.name && f.login.trim()) ? 1 : 0.5 }}>Добавить вебмастера</button>
    </div>
  );
}

function EditWebmasterForm({ wm, teamLeaders, onSave }) {
  const [f, setF] = useState({
    name: wm.name,
    team: wm.team || "",
    pin: wm.pin || "",
    login: wm.login || "",
    teamLeaderId: wm.teamLeaderId || "",
    rank: wm.rank || "junior",
  });

  const handleSave = () => {
    if (!f.name) return;
    onSave({ id: wm.id, name: f.name, team: f.team, login: f.login.trim().toLowerCase() || wm.login, pin: f.pin || wm.pin, teamLeaderId: f.teamLeaderId || null, rank: f.rank });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={styles.formLabel}>Имя</label>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={styles.input} placeholder="Имя вебмастера" />
      </div>
      <div>
        <label style={styles.formLabel}>Логин</label>
        <input value={f.login} onChange={(e) => setF({ ...f, login: e.target.value.replace(/\s/g, "") })} style={styles.input} placeholder="Логин для входа" />
        <div style={{ fontSize: 10, color: "#71717a", marginTop: 4 }}>Текущий: {wm.login || "не установлен"}</div>
      </div>
      <div>
        <label style={styles.formLabel}>Класс</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {WM_RANKS.map(r => (
            <button key={r} onClick={() => setF({ ...f, rank: r })} type="button" style={{ padding: "8px 4px", borderRadius: 8, border: f.rank === r ? `2px solid ${RANK_COLORS[r]}` : "1px solid #27272a", background: f.rank === r ? RANK_COLORS[r] + "18" : "transparent", color: f.rank === r ? RANK_COLORS[r] : "#a1a1aa", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
              {RANK_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={styles.formLabel}>Команда / Проект</label>
        <input value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} style={styles.input} placeholder="Название команды" />
      </div>
      <div>
        <label style={styles.formLabel}>Тим-лидер</label>
        <select value={f.teamLeaderId} onChange={(e) => setF({ ...f, teamLeaderId: e.target.value })} style={styles.input}>
          <option value="">— Без тим-лидера —</option>
          {teamLeaders.map(tl => <option key={tl.id} value={tl.id}>{tl.name}</option>)}
        </select>
        {f.teamLeaderId !== (wm.teamLeaderId || "") && (
          <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4 }}>⚠ Тим-лидер будет изменён</div>
        )}
      </div>
      <div>
        <label style={styles.formLabel}>Пароль</label>
        <input value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} style={styles.input} placeholder="Введите новый пароль" type="password" />
        <div style={{ fontSize: 10, color: "#71717a", marginTop: 4 }}>Оставьте пустым, чтобы не менять пароль</div>
      </div>
      <button onClick={handleSave} disabled={!f.name} style={{ ...styles.btnPrimary, opacity: f.name ? 1 : 0.5 }}>Сохранить изменения</button>
    </div>
  );
}

function AddTransactionForm({ wmId, userId, onSave }) {
  const [f, setF] = useState({
    type: "salary",
    amount: "",
    description: "",
    category: "",
    date: new Date().toISOString().slice(0, 10),
    reportMonth: getCurrentMonth(),
  });

  const handleSave = () => {
    if (!f.amount || isNaN(f.amount)) return;
    onSave({
      id: uid(),
      wmId,
      type: f.type,
      amount: parseFloat(f.amount),
      description: f.description,
      category: f.category,
      date: f.date,
      reportMonth: f.reportMonth,
      createdBy: userId,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={styles.formLabel}>Type *</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {["salary", "bonus", "expense", "revenue"].map((t) => (
            <button
              key={t}
              onClick={() => setF({ ...f, type: t })}
              style={{
                ...styles.chip,
                ...(f.type === t ? { ...styles.chipActive, ...typeBadgeColor(t) } : {}),
                padding: "10px 16px",
                textAlign: "center",
              }}
            >
              {t === "salary" ? "💰 Зарплата" : t === "bonus" ? "🎁 Бонус" : t === "expense" ? "📦 Расходник" : "📈 Доход"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={styles.formLabel}>Сумма (USD) *</label>
        <input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={styles.input} placeholder="0" type="number" min="0" autoFocus />
      </div>
      <div>
        <label style={styles.formLabel}>Описание</label>
        <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={styles.input} placeholder="Назначение платежа" />
      </div>
      <div>
        <label style={styles.formLabel}>Категория</label>
        <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={styles.input} placeholder="хостинг, инструменты, реклама..." />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} label="📅 Дата внесения" hint="Когда операция была внесена" />
        <MonthPicker value={f.reportMonth} onChange={(v) => setF({ ...f, reportMonth: v })} label="📊 Отчётный месяц" hint="К какому месяцу относится" />
      </div>
      <button onClick={handleSave} disabled={!f.amount} style={{ ...styles.btnPrimary, opacity: f.amount ? 1 : 0.5 }}>Сохранить операцию</button>
    </div>
  );
}

function AddTransactionFormGlobal({ webmasters, userId, onSave }) {
  const [f, setF] = useState({
    wmId: webmasters.length > 0 ? webmasters[0].id : "",
    type: "salary",
    amount: "",
    description: "",
    category: "",
    date: new Date().toISOString().slice(0, 10),
    reportMonth: getCurrentMonth(),
  });

  const handleSave = () => {
    if (!f.amount || isNaN(f.amount) || !f.wmId) return;
    onSave({
      id: uid(),
      wmId: f.wmId,
      type: f.type,
      amount: parseFloat(f.amount),
      description: f.description,
      category: f.category,
      date: f.date,
      reportMonth: f.reportMonth,
      createdBy: userId,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={styles.formLabel}>Вебмастер *</label>
        <select value={f.wmId} onChange={(e) => setF({ ...f, wmId: e.target.value })} style={styles.input}>
          {webmasters.map((wm) => (
            <option key={wm.id} value={wm.id}>{wm.name}{wm.team ? ` (${wm.team})` : ""}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={styles.formLabel}>Type *</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {["salary", "bonus", "expense", "revenue"].map((t) => (
            <button
              key={t}
              onClick={() => setF({ ...f, type: t })}
              style={{
                ...styles.chip,
                ...(f.type === t ? { ...styles.chipActive, ...typeBadgeColor(t) } : {}),
                padding: "10px 16px",
                textAlign: "center",
              }}
            >
              {t === "salary" ? "💰 Зарплата" : t === "bonus" ? "🎁 Бонус" : t === "expense" ? "📦 Расходник" : "📈 Доход"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={styles.formLabel}>Сумма (USD) *</label>
        <input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={styles.input} placeholder="0" type="number" min="0" />
      </div>
      <div>
        <label style={styles.formLabel}>Описание</label>
        <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={styles.input} placeholder="Назначение платежа" />
      </div>
      <div>
        <label style={styles.formLabel}>Категория</label>
        <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={styles.input} placeholder="хостинг, инструменты, реклама..." />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} label="📅 Дата внесения" hint="Когда операция была внесена" />
        <MonthPicker value={f.reportMonth} onChange={(v) => setF({ ...f, reportMonth: v })} label="📊 Отчётный месяц" hint="К какому месяцу относится" />
      </div>
      <button onClick={handleSave} disabled={!f.amount || !f.wmId} style={{ ...styles.btnPrimary, opacity: (f.amount && f.wmId) ? 1 : 0.5 }}>Сохранить операцию</button>
    </div>
  );
}

function EditTransactionForm({ tx, webmasters, onSave }) {
  const cleanDate = (d) => d ? String(d).slice(0, 10) : "";
  const [f, setF] = useState({
    type: tx.type,
    amount: String(tx.amount),
    description: tx.description || "",
    category: tx.category || "",
    date: cleanDate(tx.date),
    reportMonth: tx.reportMonth || getMonthKey(cleanDate(tx.date) || new Date().toISOString().slice(0,10)),
    wmId: tx.wmId,
  });

  const handleSave = () => {
    if (!f.amount || isNaN(f.amount)) return;
    onSave({
      id: tx.id,
      wmId: f.wmId,
      type: f.type,
      amount: parseFloat(f.amount),
      description: f.description,
      category: f.category,
      date: f.date,
      reportMonth: f.reportMonth,
    });
  };

  const wmName = webmasters.find(w => w.id === tx.wmId)?.name || "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ padding: "10px 14px", background: "#9333ea0d", borderRadius: 10, fontSize: 13, color: "#c084fc" }}>
        Редактирование операции для <strong>{wmName}</strong>
      </div>
      <div>
        <label style={styles.formLabel}>Вебмастер</label>
        <select value={f.wmId} onChange={(e) => setF({ ...f, wmId: e.target.value })} style={styles.input}>
          {webmasters.map((wm) => (
            <option key={wm.id} value={wm.id}>{wm.name}{wm.team ? ` (${wm.team})` : ""}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={styles.formLabel}>Type *</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {["salary", "bonus", "expense", "revenue"].map((t) => (
            <button
              key={t}
              onClick={() => setF({ ...f, type: t })}
              style={{
                ...styles.chip,
                ...(f.type === t ? { ...styles.chipActive, ...typeBadgeColor(t) } : {}),
                padding: "10px 16px",
                textAlign: "center",
              }}
            >
              {t === "salary" ? "💰 Зарплата" : t === "bonus" ? "🎁 Бонус" : t === "expense" ? "📦 Расходник" : "📈 Доход"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={styles.formLabel}>Сумма (USD) *</label>
        <input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={styles.input} placeholder="0" type="number" min="0" autoFocus />
      </div>
      <div>
        <label style={styles.formLabel}>Описание</label>
        <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={styles.input} placeholder="Назначение платежа" />
      </div>
      <div>
        <label style={styles.formLabel}>Категория</label>
        <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={styles.input} placeholder="хостинг, инструменты, реклама..." />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} label="📅 Дата внесения" hint="Когда операция была внесена" />
        <MonthPicker value={f.reportMonth} onChange={(v) => setF({ ...f, reportMonth: v })} label="📊 Отчётный месяц" hint="К какому месяцу относится" />
      </div>
      <button onClick={handleSave} disabled={!f.amount} style={{ ...styles.btnPrimary, opacity: f.amount ? 1 : 0.5 }}>Сохранить изменения</button>
    </div>
  );
}

// ==================== ACTIVITY LOG ====================
function ActivityLogView({ logs, users, webmasters }) {
  const [filter, setFilter] = useState("all");

  const actionLabels = {
    // Frontend action names
    tx_created:           { label: "Транзакция создана",   color: "#10b981", icon: "+" },
    tx_edited:            { label: "Транзакция изменена",  color: "#f59e0b", icon: "✎" },
    tx_deleted:           { label: "Транзакция удалена",   color: "#ef4444", icon: "×" },
    webmaster_added:      { label: "Веб добавлен",         color: "#9333ea", icon: "◎" },
    wm_edited:            { label: "Веб изменён",          color: "#c084fc", icon: "✎" },
    wm_fired:             { label: "Веб уволен",           color: "#ef4444", icon: "✕" },
    wm_restored:          { label: "Веб восстановлен",     color: "#10b981", icon: "↩" },
    tl_added:             { label: "Тим-лид добавлен",     color: "#38bdf8", icon: "◐" },
    tl_edited:            { label: "Тим-лид изменён",      color: "#38bdf8", icon: "✎" },
    tl_deleted:           { label: "Тим-лид удалён",       color: "#ef4444", icon: "×" },
    user_added:           { label: "Юзер добавлен",        color: "#c084fc", icon: "◇" },
    user_deleted:         { label: "Юзер удалён",          color: "#ef4444", icon: "◇" },
    // Backend action names (from server.js)
    "Created transaction":  { label: "Транзакция создана",   color: "#10b981", icon: "+" },
    "Updated transaction":  { label: "Транзакция изменена",  color: "#f59e0b", icon: "✎" },
    "Deleted transaction":  { label: "Транзакция удалена",   color: "#ef4444", icon: "×" },
    "Created webmaster":    { label: "Веб добавлен",         color: "#9333ea", icon: "◎" },
    "Updated webmaster":    { label: "Веб изменён",          color: "#c084fc", icon: "✎" },
    "Deleted webmaster":    { label: "Веб удалён",           color: "#ef4444", icon: "✕" },
    "Restored webmaster":   { label: "Веб восстановлен",     color: "#10b981", icon: "↩" },
    "Created team leader":  { label: "Тим-лид добавлен",     color: "#38bdf8", icon: "◐" },
    "Updated team leader":  { label: "Тим-лид изменён",      color: "#38bdf8", icon: "✎" },
    "Deleted team leader":  { label: "Тим-лид удалён",       color: "#ef4444", icon: "×" },
    "User login":           { label: "Вход",                 color: "#10b981", icon: "→" },
    "User logout":          { label: "Выход",                color: "#71717a", icon: "←" },
  };

  // Get unique action types that actually exist in logs
  const existingActions = [...new Set(logs.map(l => l.action))];
  const actionTypes = ["all", ...existingActions];
  const filtered = filter === "all" ? logs : logs.filter((l) => l.action === filter);

  const fmtTime = (ts) => {
    const d = new Date(ts);
    return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <div>
      <h1 style={styles.pageTitle}>Activity Log</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {actionTypes.map((f) => {
          const info = actionLabels[f];
          return (
            <button key={f} onClick={() => setFilter(f)} style={{ ...styles.chip, ...(filter === f ? styles.chipActive : {}) }}>
              {f === "all" ? `All (${logs.length})` : `${info?.label || f} (${logs.filter(l => l.action === f).length})`}
            </button>
          );
        })}
      </div>

      <div style={styles.card}>
        {filtered.length === 0 ? (
          <div style={styles.emptyState}>Действий пока нет. Все операции будут записаны здесь.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {filtered.map((log) => {
              const info = actionLabels[log.action] || { label: log.action, color: "#a1a1aa", icon: "•" };
              return (
                <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 0", borderBottom: "1px solid #27272a" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: info.color + "18", color: info.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                    {info.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ ...styles.typeBadge, background: info.color + "18", color: info.color, fontSize: 10 }}>{info.label}</span>
                      <span style={{ fontSize: 12, color: "#71717a" }}>{fmtTime(log.timestamp)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#d4d4d8", lineHeight: 1.5 }}>{log.details}</div>
                    <div style={{ fontSize: 11, color: "#52525b", marginTop: 4 }}>{log.userName}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== MODAL ====================
function Modal({ title, onClose, children }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={styles.deleteBtn}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ==================== HELPERS ====================
const typeBadgeColor = (type) => ({
  salary: { background: "#9333ea18", color: "#9333ea" },
  bonus: { background: "#f59e0b18", color: "#f59e0b" },
  expense: { background: "#ef444418", color: "#ef4444" },
  revenue: { background: "#10b98118", color: "#10b981" },
}[type] || {});

// ==================== STYLES ====================
const styles = {
  app: { display: "flex", minHeight: "100vh", fontFamily: "'DM Sans', -apple-system, sans-serif", background: "#09090b", color: "#fafafa", fontSize: "14px" },

  // Sidebar
  sidebar: { width: 240, background: "#18181b", borderRight: "1px solid #27272a", display: "flex", flexDirection: "column", padding: "20px 12px", flexShrink: 0 },
  sidebarTop: { marginBottom: 24 },
  logo: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 },
  logoIcon: { width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #9333ea, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff" },
  logoText: { fontSize: 18, fontWeight: 800, letterSpacing: -0.5 },
  userBadge: { display: "flex", alignItems: "center", gap: 10, padding: 10, background: "#27272a", borderRadius: 12 },
  avatar: { width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #9333ea, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0 },
  userName: { fontWeight: 600, fontSize: 13 },
  userRole: { fontSize: 11, opacity: 0.5 },
  nav: { display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  navItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "none", background: "transparent", color: "#a1a1aa", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 500, textAlign: "left", transition: "all 0.15s" },
  navItemActive: { background: "#9333ea18", color: "#c084fc", fontWeight: 600 },
  navIcon: { fontSize: 16 },
  logout: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid #27272a", background: "transparent", color: "#71717a", borderRadius: 10, cursor: "pointer", fontSize: 13, marginTop: 8 },

  // Main
  main: { flex: 1, padding: 32, overflowY: "auto", maxHeight: "100vh" },
  pageTitle: { fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 24, color: "#fafafa" },

  // Stats
  statGrid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 },
  statCard: { background: "#18181b", borderRadius: 16, padding: 20, border: "1px solid #27272a" },
  statIcon: { width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, marginBottom: 12 },
  statLabel: { fontSize: 12, color: "#71717a", marginBottom: 4, fontWeight: 500 },
  statValue: { fontSize: 24, fontWeight: 800, letterSpacing: -0.5 },

  // Cards
  card: { background: "#18181b", borderRadius: 16, padding: 24, border: "1px solid #27272a", marginBottom: 20 },
  cardRow: { display: "flex", gap: 16, marginBottom: 20 },
  cardTitle: { fontSize: 15, fontWeight: 700, marginBottom: 16, color: "#fafafa" },

  // Table
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "8px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#71717a", borderBottom: "1px solid #27272a", fontWeight: 600 },
  td: { padding: "12px", borderBottom: "1px solid #27272a08", fontSize: 14 },
  tableRow: { cursor: "pointer", transition: "background 0.15s" },

  // Badges
  typeBadge: { padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
  chip: { padding: "6px 14px", borderRadius: 20, border: "1px solid #27272a", background: "transparent", color: "#a1a1aa", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.15s" },
  chipActive: { background: "#9333ea", color: "#fff", borderColor: "#9333ea" },

  // WM Card
  wmCard: { background: "#18181b", borderRadius: 16, padding: 20, border: "1px solid #27272a", cursor: "pointer", transition: "all 0.2s" },
  wmStat: { background: "#09090b", borderRadius: 10, padding: 10, textAlign: "center" },

  // Forms
  input: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #27272a", background: "#09090b", color: "#fafafa", fontSize: 14, boxSizing: "border-box", outline: "none" },
  formLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "#a1a1aa", marginBottom: 6 },

  // Buttons
  btnPrimary: { padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #9333ea, #7c3aed)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: -0.3 },
  btnGhost: { padding: "8px 16px", borderRadius: 8, border: "1px solid #27272a", background: "transparent", color: "#a1a1aa", fontSize: 13, cursor: "pointer" },
  deleteBtn: { width: 28, height: 28, borderRadius: 8, border: "none", background: "#ef444418", color: "#ef4444", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  editBtn: { width: 28, height: 28, borderRadius: 8, border: "none", background: "#9333ea18", color: "#c084fc", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },

  // Modal
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" },
  modalCard: { background: "#18181b", borderRadius: 20, padding: 28, border: "1px solid #27272a", width: "100%", maxWidth: 440, maxHeight: "80vh", overflow: "auto" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },

  // Login
  loginWrap: { minHeight: "100vh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#09090b", fontFamily: "'DM Sans', -apple-system, sans-serif", margin: 0, padding: 0 },
  loginCard: { background: "#18181b", borderRadius: 24, padding: 36, border: "1px solid #27272a", width: "100%", maxWidth: 380, color: "#fafafa" },
  loginLogo: { display: "flex", justifyContent: "center", marginBottom: 16 },
  loginTitle: { textAlign: "center", fontSize: 28, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 },
  loginSub: { textAlign: "center", fontSize: 13, color: "#71717a", marginBottom: 28 },
  loginLabel: { fontSize: 13, fontWeight: 600, color: "#a1a1aa", marginBottom: 12 },

  errorText: { color: "#ef4444", fontSize: 13, textAlign: "center", marginTop: 8 },

  // Misc
  emptyState: { textAlign: "center", padding: 40, color: "#52525b", fontSize: 14 },
  toast: { position: "fixed", top: 20, right: 20, padding: "12px 20px", borderRadius: 12, color: "#fff", fontSize: 14, fontWeight: 600, zIndex: 2000, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", animation: "fadeIn 0.2s" },
};
