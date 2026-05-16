import React, { useState } from 'react';
import { motion } from 'motion/react';
import { InstitutionProfile } from '../types';

interface LoginProps {
  onLogin: (staffId: string, pin: string) => void;
  institution: InstitutionProfile;
}

export default function Login({ onLogin, institution }: LoginProps) {
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(staffId, pin);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md border border-slate-200"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 bg-emerald-600 rounded-3xl flex items-center justify-center text-white font-bold text-3xl shadow-xl shadow-emerald-200 mb-6">
            MG
          </div>
          <h2 className="text-xl font-bold uppercase tracking-tight text-slate-800 text-center">{institution.name}</h2>
          <div className="mt-2 text-center">
            <span className="text-emerald-600 font-bold">DCfeePay</span>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 text-center">Digital Communique Private Limited</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">User Identification</label>
            <input 
              type="text" 
              placeholder="e.g. admin"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-slate-800 placeholder:text-slate-300 font-medium"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Access PIN</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-slate-800 placeholder:text-slate-300 font-medium tracking-[0.5em]"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-emerald-600 text-white font-bold py-4 rounded-3xl shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-[0.98] mt-4"
          >
            SIGN IN TO CLOUD
          </button>
        </form>

        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 shadow-sm">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            Verified Build • Private Ledger
          </div>
        </div>
      </motion.div>
    </div>
  );
}
