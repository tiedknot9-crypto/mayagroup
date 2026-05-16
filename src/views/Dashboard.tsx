import { useMemo } from 'react';
import { 
  TrendingUp, 
  HandCoins, 
  Hourglass, 
  GraduationCap,
  CircleDot,
  CreditCard
} from 'lucide-react';
import { AppData } from '../types';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

interface DashboardProps {
  data: AppData;
}

export default function Dashboard({ data }: DashboardProps) {
  const stats = useMemo(() => {
    const totalReceived = data.transactions.reduce((sum, t) => sum + t.amount, 0);
    const totalRevenue = data.students.reduce((sum, s) => {
      const plan = data.feePlans.find(p => p.id === s.planId);
      return sum + (plan?.totalAmount || 0);
    }, 0);
    
    const outstandingDues = data.students.reduce((sum, s) => {
      const plan = data.feePlans.find(p => p.id === s.planId);
      const studentPaid = data.transactions
        .filter(t => t.studentId === s.id)
        .reduce((sSum, t) => sSum + t.amount, 0);
      return sum + Math.max(0, (plan?.totalAmount || 0) - studentPaid);
    }, 0);
    
    return [
      { label: 'Total Revenue', value: `₹${totalRevenue.toLocaleString()}`, color: 'bg-indigo-50', icon: TrendingUp, iconColor: 'text-indigo-600' },
      { label: 'Total Received', value: `₹${totalReceived.toLocaleString()}`, color: 'bg-emerald-50', icon: HandCoins, iconColor: 'text-emerald-600' },
      { label: 'Outstanding Dues', value: `₹${outstandingDues.toLocaleString()}`, color: 'bg-rose-50', icon: Hourglass, iconColor: 'text-rose-600' },
      { label: 'Total Students', value: data.students.length.toString(), color: 'bg-slate-50', icon: GraduationCap, iconColor: 'text-slate-600' },
    ];
  }, [data]);

  const courseCollections = useMemo(() => {
    const collections: Record<string, number> = {};
    data.feePlans.forEach(plan => {
      collections[plan.name] = 0;
    });

    data.transactions.forEach(txn => {
      const student = data.students.find(s => s.id === txn.studentId);
      const plan = data.feePlans.find(p => p.id === student?.planId);
      if (plan) {
        collections[plan.name] = (collections[plan.name] || 0) + txn.amount;
      }
    });

    return Object.entries(collections).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="relative z-10 text-center sm:text-left">
          <h2 className="text-3xl font-black text-slate-800 italic uppercase">Dashboard Overview</h2>
          <p className="text-slate-500 font-medium tracking-tight">Real-time analytical view of {data.institution.name}</p>
        </div>
        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-2 bg-emerald-50 text-emerald-600 px-4 py-2 rounded-full border border-emerald-100">
           <CircleDot className="animate-pulse" size={14} />
           <span className="text-xs font-black uppercase tracking-widest">System Active</span>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-100/30 rounded-full blur-3xl -mr-32 -mt-32"></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white rounded-[32px] p-6 border border-slate-200 shadow-sm group hover:border-emerald-200 transition-all">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-4 rounded-[20px] ${stat.color} ${stat.iconColor}`}>
                <stat.icon size={24} />
              </div>
              <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">Live</span>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1 ml-1">{stat.label}</p>
            <h3 className="text-3xl font-black text-slate-800 tracking-tight">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
            <TrendingUp size={24} className="text-slate-800" />
            <h3 className="text-xl font-black text-slate-800 tracking-tight">Collections by Plan</h3>
          </div>
          <div className="space-y-4">
            {courseCollections.map(([course, amount]) => (
              <div key={course} className="flex items-center justify-between py-4 border-b border-slate-50 last:border-0 group">
                <span className="font-bold text-slate-600 group-hover:text-slate-900 transition-colors uppercase tracking-tight">{course}</span>
                <span className="font-bold text-slate-900 tracking-tight italic">₹{amount.toFixed(2)}</span>
              </div>
            ))}
            {courseCollections.length === 0 && (
              <p className="text-center py-12 text-slate-300 font-bold uppercase tracking-widest italic opacity-50">No courses defined</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
            <CreditCard size={24} className="text-slate-800" />
            <h3 className="text-xl font-black text-slate-800 tracking-tight">Active Fee Plans</h3>
          </div>
          <div className="space-y-4">
             {data.feePlans.map(plan => {
               const studentCount = data.students.filter(s => s.planId === plan.id).length;
               return (
                 <div key={plan.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-slate-800 uppercase tracking-tight text-sm">{plan.name}</span>
                        <span className="bg-emerald-100 text-emerald-700 text-[9px] font-black px-1.5 py-0.5 rounded uppercase">Active</span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">{plan.frequency} • {plan.components.length} Components</p>
                    </div>
                    <div className="text-right">
                       <p className="font-black text-slate-900 text-sm">₹{plan.totalAmount.toLocaleString()}</p>
                       <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">{studentCount} Students</p>
                    </div>
                 </div>
               );
             })}
          </div>
        </div>

        <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
            <CreditCard size={24} className="text-slate-800" />
            <h3 className="text-xl font-black text-slate-800 tracking-tight">Recent Activity</h3>
          </div>
          <div className="space-y-6">
            {data.transactions.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em]">No Recent Transactions</p>
               </div>
            ) : (
              data.transactions.slice(0, 10).map((t) => {
                const student = data.students.find(s => s.id === t.studentId);
                return (
                  <div key={t.id} className="relative pl-0 border-b border-slate-50 pb-6 last:border-0">
                    <div className="flex items-baseline justify-between mb-1">
                      <p className="text-lg font-black text-slate-900 uppercase tracking-tight">
                        {student?.name || 'Unknown Student'} <span className="font-medium text-slate-500 lowercase italic ml-1">paid ₹{t.amount.toFixed(2)}</span>
                      </p>
                    </div>
                    <p className="text-sm text-slate-400 font-bold italic">
                      {new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
