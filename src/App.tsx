import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  CreditCard, 
  FileText, 
  Settings, 
  LogOut,
  Wallet,
  CheckCircle2,
  AlertCircle,
  Menu,
  X,
  Search,
  Plus,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppData, Student, Transaction, FeePlan, PaymentMode, Staff } from './types';
import { INITIAL_DATA, COLORS } from './constants';
import { HISTORICAL_TRANSACTIONS_RAW } from './seedData';
import { supabaseService } from './services/supabaseService';
import { supabase } from './lib/supabase';

// Views
import Dashboard from './views/Dashboard';
import Students from './views/Students';
import FeePlans from './views/FeePlans';
import Payments from './views/Payments';
import Reports from './views/Reports';
import SettingsView from './views/Settings';
import Login from './views/Login';

export default function App() {
  const [data, setData] = useState<AppData>(() => {
    const saved = localStorage.getItem('maya_fee_data');
    if (!saved) return INITIAL_DATA;
    
    const parsed = JSON.parse(saved);
    return {
      ...INITIAL_DATA,
      ...parsed,
      masters: {
        ...INITIAL_DATA.masters,
        ...(parsed.masters || {})
      },
      staff: parsed.staff || INITIAL_DATA.staff,
      institution: {
        ...INITIAL_DATA.institution,
        ...(parsed.institution || {})
      },
      hasSeeded: parsed.hasSeeded || false
    };
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'error' | 'tables_missing'>('disconnected');
  const [lastLocalWrite, setLastLocalWrite] = useState<number>(0);

  const loadFromDb = useCallback(async (showIndicator = true) => {
    // Sync Guard: If we JUST wrote data locally (in the last 30s), 
    // ignore background syncs to prevent overwriting local state with stale cloud data.
    if (!showIndicator && Date.now() - lastLocalWrite < 30000) {
      console.log('[Supabase] Sync ignored: Protected by local write lock.');
      return;
    }

    if (showIndicator) setIsRefreshing(true);
    try {
      const dbDataPromise = supabaseService.fetchAppData();
      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 30000)
      );

      const dbData = await Promise.race([dbDataPromise, timeoutPromise]);

      if (dbData === null) {
        // Double check if it's a tables missing error
        const health = await supabaseService.checkHealth();
        if (!health.tablesExist) {
          setDbStatus('tables_missing');
          console.warn('[Supabase] Sync failed: Database tables do not exist.');
        } else {
          setDbStatus('disconnected');
        }
        return;
      }
      
      if (dbData) {
        console.log(`[Supabase] Cloud Fetch: ${dbData.students.length} students, ${dbData.transactions.length} transactions, ${dbData.feePlans.length} plans.`);
        
        setData(prevData => {
          // Conflict-Aware Merge: Use updatedAt to decide which record wins.
          const mergeRecord = <T extends { id: string; updatedAt?: string }>(local: T, remote: T): T => {
            if (!local.updatedAt) return remote;
            if (!remote.updatedAt) return local;
            return new Date(local.updatedAt) >= new Date(remote.updatedAt) ? local : remote;
          };

          const studentMap = new Map<string, Student>();
          dbData.students.forEach(s => studentMap.set(s.id, s));
          prevData.students.forEach(local => {
            const remote = studentMap.get(local.id);
            studentMap.set(local.id, remote ? mergeRecord(local, remote) : local);
          });
          const mergedStudents = Array.from(studentMap.values());

          const txnMap = new Map<string, Transaction>();
          dbData.transactions.forEach(t => txnMap.set(t.id, t));
          prevData.transactions.forEach(local => {
            const remote = txnMap.get(local.id);
            txnMap.set(local.id, remote ? mergeRecord(local, remote) : local);
          });
          const mergedTxns = Array.from(txnMap.values());

          const planMap = new Map<string, FeePlan>();
          dbData.feePlans.forEach(p => planMap.set(p.id, p));
          prevData.feePlans.forEach(local => {
            const remote = planMap.get(local.id);
            planMap.set(local.id, remote ? mergeRecord(local, remote) : local);
          });
          const mergedPlans = Array.from(planMap.values());

          const staffMap = new Map<string, Staff>();
          dbData.staff.forEach(s => staffMap.set(s.id, s));
          prevData.staff.forEach(local => {
            const remote = staffMap.get(local.id);
            staffMap.set(local.id, remote ? mergeRecord(local, remote) : local);
          });
          const mergedStaff = Array.from(staffMap.values());

          const finalData = {
            ...dbData,
            students: mergedStudents,
            transactions: mergedTxns,
            feePlans: mergedPlans,
            staff: mergedStaff,
            institution: mergeRecord(prevData.institution as any, dbData.institution as any) as any,
            masters: dbData.masters.branches.length > 0 ? dbData.masters : prevData.masters
          };

          // Ensure default admin
          const adminIndex = finalData.staff.findIndex(s => s.id === 'admin');
          if (adminIndex === -1) {
            finalData.staff.push(INITIAL_DATA.staff[0]);
          } else {
            finalData.staff[adminIndex].pin = INITIAL_DATA.staff[0].pin;
          }
          
          return finalData;
        });

        setDbStatus('connected');
        setLastSynced(new Date());
      } else {
        console.warn('Database connection timed out or returned no data. Using local fallback.');
        setDbStatus('disconnected');
      }
    } catch (error) {
      console.error('Critical error during database sync:', error);
      setDbStatus('error');
    } finally {
      if (showIndicator) setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [lastLocalWrite]);

  // Supabase Load & Realtime Subscriptions
  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          console.log('[Supabase] Initializing anonymous session...');
          await supabase.auth.signInAnonymously();
        }
      } catch (err) {
        console.error('[Supabase] Auth initialization failed:', err);
      }
    };

    initAuth().then(() => loadFromDb(false));

    // Set up real-time subscriptions for multi-user sync
    const channels = [
      supabase.channel('public-payments').on('postgres_changes', { event: '*', table: 'payments', schema: 'public' }, () => loadFromDb(false)).subscribe(),
      supabase.channel('public-students').on('postgres_changes', { event: '*', table: 'students', schema: 'public' }, () => loadFromDb(false)).subscribe(),
      supabase.channel('public-courses').on('postgres_changes', { event: '*', table: 'courses', schema: 'public' }, () => loadFromDb(false)).subscribe(),
      supabase.channel('public-settings').on('postgres_changes', { event: '*', table: 'settings', schema: 'public' }, () => loadFromDb(false)).subscribe()
    ];

    // Fallback polling (every 60s) just in case socket drops
    const pollInterval = setInterval(() => loadFromDb(false), 60000);

    return () => {
      channels.forEach(channel => supabase.removeChannel(channel));
      clearInterval(pollInterval);
    };
  }, [loadFromDb]);

  // Data Hydration for historical payments provided via chat
  useEffect(() => {
    // User requested a clean start. Seeding is disabled.
    if (!data.hasSeeded) {
      setData(prev => ({ ...prev, hasSeeded: true }));
    }
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('maya_auth') === 'true';
  });

  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);

  useEffect(() => {
    if (isAuthenticated && !currentStaff) {
      // Try to recover current staff from local storage or just find first admin if unknown
      const savedStaffId = localStorage.getItem('maya_staff_id');
      if (savedStaffId) {
        const staff = data.staff.find(s => s.id === savedStaffId);
        if (staff) setCurrentStaff(staff);
      }
    }
  }, [isAuthenticated, data.staff, currentStaff]);

  const [activeView, setActiveView] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Anti-Copy and Anti-Inspect Logic
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, Ctrl+S, Ctrl+P, PrintScreen
      if (
        e.keyCode === 123 || // F12
        e.keyCode === 44 ||  // PrintScreen
        (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) || // I, J, C
        (e.ctrlKey && (e.keyCode === 85 || e.keyCode === 83 || e.keyCode === 80)) || // U, S, P
        (e.metaKey && e.shiftKey && (e.keyCode === 52 || e.keyCode === 51)) // MacOS Screenshot keys
      ) {
        e.preventDefault();
        return false;
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      alert('Content protected by MAYA Fee System Security');
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        document.title = 'MAYA Protected';
      } else {
        document.title = data.institution.name + ' | MAYA Fee System';
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('copy', handleCopy);
    window.addEventListener('dragstart', handleDragStart);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('dragstart', handleDragStart);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [data.institution.name]);

  useEffect(() => {
    localStorage.setItem('maya_fee_data', JSON.stringify(data));
  }, [data]);

  const updateDataWithLock = (updater: (prev: AppData) => AppData) => {
    setLastLocalWrite(Date.now());
    setData(prev => {
      const newData = updater(prev);
      
      // Inject timestamps into updated records so sync knows which one is newer
      const now = new Date().toISOString();
      
      return {
        ...newData,
        students: newData.students.map(s => ({ ...s, updatedAt: s.updatedAt || now })),
        transactions: newData.transactions.map(t => ({ ...t, updatedAt: t.updatedAt || now })),
        feePlans: newData.feePlans.map(p => ({ ...p, updatedAt: p.updatedAt || now })),
        staff: newData.staff.map(s => ({ ...s, updatedAt: s.updatedAt || now })),
        institution: { ...newData.institution, updatedAt: now }
      };
    });
  };

  const handleLogin = (staffId: string, pin: string) => {
    const staffMember = data.staff.find(s => s.id === staffId && s.pin === pin);
    if (staffMember) {
      setIsAuthenticated(true);
      setCurrentStaff(staffMember);
      localStorage.setItem('maya_auth', 'true');
      localStorage.setItem('maya_staff_id', staffMember.id);
    } else {
      alert('Invalid credentials. Please check your Staff ID and PIN.');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentStaff(null);
    localStorage.removeItem('maya_auth');
    localStorage.removeItem('maya_staff_id');
  };

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 p-10 text-center">
        <div className="w-16 h-16 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Synchronizing Cloud Ledger...</p>
        <p className="text-slate-300 text-xs mt-2 max-w-xs">Establishing secure connection to MAYA Global Database...</p>
        
        <div className="mt-8 flex flex-col gap-3">
          <button 
            onClick={() => {
              console.warn('Sync skipped by user');
              setIsLoading(false);
            }}
            className="px-8 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-black text-slate-400 hover:text-emerald-600 uppercase tracking-widest shadow-sm transition-all"
          >
            Access Offline Mode
          </button>
          <p className="text-[9px] text-slate-300 italic font-medium">Use offline mode if internet is slow. Data will sync on next refresh.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} institution={data.institution} />;
  }

  const renderView = () => {
    switch (activeView) {
      case 'dashboard': return <Dashboard data={data} />;
      case 'plans': return <FeePlans data={data} setData={updateDataWithLock} setIsRefreshing={setIsRefreshing} />;
      case 'students': return <Students data={data} setData={updateDataWithLock} />;
      case 'payments': return <Payments data={data} setData={updateDataWithLock} currentStaff={currentStaff} />;
      case 'reports': return <Reports data={data} setData={updateDataWithLock} />;
      case 'settings': return <SettingsView data={data} setData={updateDataWithLock} />;
      default: return <Dashboard data={data} />;
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'plans', label: 'Fee Plans', icon: Wallet },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div 
      className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden"
    >
      {/* Mobile Overlay */}
      {!isSidebarOpen && (
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-slate-200"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-slate-200 flex flex-col h-full relative z-40 overflow-hidden"
      >
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-emerald-200 overflow-hidden">
            {data.institution.logo ? (
              <img src={data.institution.logo} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              'MG'
            )}
          </div>
          <div className="overflow-hidden whitespace-nowrap">
            <h1 className="font-bold text-lg leading-tight uppercase truncate max-w-[140px]" title={data.institution.name}>
              {data.institution.name.split(' ')[0]} {data.institution.name.split(' ')[1] || ''}
            </h1>
            <p className="text-[10px] text-emerald-600 font-black tracking-widest uppercase">EDUPAY CLOUD</p>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden ml-auto">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                activeView === item.id 
                  ? 'bg-emerald-50 text-emerald-700 font-semibold shadow-sm shadow-emerald-100' 
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <item.icon size={20} />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 mt-auto border-t border-slate-100">
          <div className="bg-slate-50 rounded-2xl p-4 mb-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">System Version</p>
            <p className="text-xs font-bold text-emerald-600">MAYA Fee System</p>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-all font-medium text-sm"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
          <div>
            <span className="bg-slate-100 text-slate-500 text-[10px] font-black uppercase px-2 py-1 rounded-full">{activeView}</span>
          </div>

          <div className="flex items-center gap-6">
            <button 
              onClick={() => loadFromDb(true)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                isRefreshing 
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
              }`}
              disabled={isRefreshing}
            >
              <Database size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Sync Data'}
            </button>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  dbStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 
                  dbStatus === 'tables_missing' ? 'bg-orange-500' : 
                  'bg-red-500'
                }`}></div>
                <span className="text-sm font-bold uppercase tracking-tight">
                  {dbStatus === 'connected' ? 'Cloud Node' : 
                   dbStatus === 'tables_missing' ? 'Setup Required' : 
                   'Disconnected'}
                </span>
              </div>
              <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest leading-none mt-1">
                {lastSynced ? `Sync: ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Supabase Connected'}
              </span>
            </div>
            <div className="w-10 h-10 bg-slate-900 border-2 border-emerald-500/20 rounded-full flex items-center justify-center text-white font-bold shadow-lg shadow-emerald-100/20">
              {currentStaff?.name.charAt(0) || 'A'}
            </div>
          </div>
        </header>

        {/* View Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {renderView()}
              
              <div className="mt-20 flex items-center justify-center gap-4 text-slate-400 pb-10">
                 <div className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    Certified Build • MAYA Fee System
                 </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
