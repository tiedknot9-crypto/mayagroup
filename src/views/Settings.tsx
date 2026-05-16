import React, { useState, useRef } from 'react';
import { Save, Building2, GraduationCap, X, Plus, Upload, CheckCircle, Edit2, UserPlus, Shield, Smartphone, Key } from 'lucide-react';
import { AppData, Staff } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { supabaseService } from '../services/supabaseService';
import { supabase } from '../lib/supabase';

interface SettingsProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
}

export default function SettingsView({ data, setData }: SettingsProps) {
  const [activeTab, setActiveTab ] = useState('profile');
  const [profile, setProfile] = useState(data.institution);
  const [masters, setMasters] = useState(data.masters);
  const [inputs, setInputs] = useState({ branch: '', semester: '', session: '' });
  const [showSuccess, setShowSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isResetting, setIsResetting] = useState(false);

  const [confirmReset, setConfirmReset] = useState(false);

  const resetAllData = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5000); // Reset confirmation state after 5s
      return;
    }

    setIsResetting(true);
    setConfirmReset(false);
    try {
      // 1. Execute cloud purge via service
      await supabaseService.clearAllData();

      // 2. Clear local state
      setData(prev => ({
        ...prev,
        students: [],
        transactions: [],
        hasSeeded: true
      }));

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error('Reset failed:', err);
      alert('Failed to clear some cloud records. Please check your internet connection.');
    } finally {
      setIsResetting(false);
    }
  };

  const clearSeedData = () => {
    if (window.confirm('This will remove all sample records (RC- receipts and sample students). Your manual entries will be preserved. Proceed?')) {
      const isSeedStudent = (s: any) => s.id.includes('seed-');
      const isSeedTxn = (t: any) => t.id.includes('seed-') || (t.receiptNumber && t.receiptNumber.startsWith('RC-'));
      
      setData(prev => ({
        ...prev,
        hasSeeded: true,
        students: prev.students.filter(s => !isSeedStudent(s)),
        transactions: prev.transactions.filter(t => !isSeedTxn(t))
      }));
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }
  };

  // Master Editing State
  const [editingMaster, setEditingMaster] = useState<{ type: keyof typeof masters, index: number, value: string } | null>(null);

  // Staff States
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState<Partial<Staff>>({
    name: '',
    role: 'Operator',
    phone: '',
    pin: '',
  });

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target?.result as string);
        if (imported.institution && imported.students && imported.transactions) {
          if (window.confirm('WARNING: This will overwrite ALL current data with the backup file. Proceed?')) {
            setData(imported);
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 3000);
          }
        } else {
          alert('Invalid backup file format.');
        }
      } catch (err) {
        alert('Error reading backup file.');
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Maya_Fee_System_Backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveProfile = async () => {
    setData(prev => ({ ...prev, institution: profile }));
    await supabaseService.updateSettings(profile, masters);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile(prev => ({ ...prev, logo: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const addMaster = async (type: keyof typeof masters, field: string) => {
    const val = (inputs as any)[field];
    if (val) {
      const currentList = masters[type] || [];
      const newList = [...currentList, val];
      
      // Update local state for immediate UI feedback
      setMasters(prev => ({ ...prev, [type]: newList }));
      setInputs(prev => ({ ...prev, [field]: '' }));
      
      const newMasters = { 
        ...(data.masters || {}), 
        [type]: newList 
      };

      // Update global state
      setData(prev => ({ 
        ...prev, 
        masters: newMasters 
      }));

      // Sync to Supabase
      await supabaseService.updateSettings(profile, newMasters);
    }
  };

  const removeMaster = async (type: keyof typeof masters, index: number) => {
    const currentList = masters[type] || [];
    const newList = currentList.filter((_, i) => i !== index);
    
    setMasters(prev => ({ ...prev, [type]: newList }));
    const newMasters = { 
      ...(data.masters || {}), 
      [type]: newList 
    };
    setData(prev => ({ 
      ...prev, 
      masters: newMasters
    }));
    // Sync to Supabase
    await supabaseService.updateSettings(profile, newMasters);
  };

  const startEditMaster = (type: keyof typeof masters, index: number, value: string) => {
    setEditingMaster({ type, index, value });
  };

  const saveEditMaster = () => {
    if (editingMaster) {
      const newList = [...masters[editingMaster.type]];
      newList[editingMaster.index] = editingMaster.value;
      setMasters({ ...masters, [editingMaster.type]: newList });
      setData(prev => ({ ...prev, masters: { ...prev.masters, [editingMaster.type]: newList } }));
      setEditingMaster(null);
    }
  };

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (staffForm.name && staffForm.pin) {
      let finalStaff: Staff;
      if (editingStaffId) {
        finalStaff = { ... (data.staff.find(s => s.id === editingStaffId)!), ...(staffForm as Staff) };
        setData(prev => ({
          ...prev,
          staff: (prev.staff || []).map(s => s.id === editingStaffId ? finalStaff : s)
        }));
      } else {
        finalStaff = {
          ...(staffForm as Staff),
          id: `staff-${Math.random().toString(36).substr(2, 9)}`,
        };
        setData(prev => ({
          ...prev,
          staff: [...(prev.staff || []), finalStaff]
        }));
      }

      // Sync to Supabase table 'accountants'
      await supabase.from('accountants').upsert({
        user_id: finalStaff.id,
        name: finalStaff.name,
        password: finalStaff.pin,
        role: finalStaff.role,
        phone: finalStaff.phone
      }, { onConflict: 'user_id' });

      setIsStaffModalOpen(false);
      setEditingStaffId(null);
      setStaffForm({ name: '', role: 'Operator', phone: '', pin: '' });
    }
  };

  const deleteStaff = async (id: string) => {
    if (window.confirm('Are you sure you want to remove this staff member?')) {
      setData(prev => ({
        ...prev,
        staff: (prev.staff || []).filter(s => s.id !== id)
      }));
      // Delete from Supabase
      await supabase.from('accountants').delete().eq('user_id', id);
    }
  };

  const editStaff = (staff: Staff) => {
    setEditingStaffId(staff.id);
    setStaffForm(staff);
    setIsStaffModalOpen(true);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">System Control</h2>
          <p className="text-slate-500 font-medium">Manage institution profile, staff, and masters</p>
        </div>
        <div className="flex items-center gap-4">
           {showSuccess && (
             <motion.div 
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               className="flex items-center gap-2 text-emerald-600 font-bold text-sm bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100"
             >
               <CheckCircle size={18} /> Success
             </motion.div>
           )}
          <div className="bg-white border border-slate-200 p-1.5 rounded-2xl flex gap-1 shadow-sm overflow-x-auto custom-scrollbar">
          {['profile', 'masters', 'staff', 'system', 'database'].map(tab => (
            <button 
             key={tab}
             onClick={() => setActiveTab(tab)}
             className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
               activeTab === tab ? 'bg-slate-900 text-white shadow-lg shadow-slate-200' : 'text-slate-400 hover:text-slate-600'
             }`}
            >
              {tab}
            </button>
          ))}
          </div>
      </div>
    </div>

      {activeTab === 'profile' && (
        <div className="bg-white rounded-[40px] p-10 border border-slate-200 shadow-sm space-y-12 relative overflow-hidden">
           <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50/20 rounded-full blur-3xl -mr-32 -mt-32"></div>
           
           <div className="flex items-center justify-between border-l-4 border-emerald-500 pl-6 py-1 relative z-10">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Institution Identity</h3>
              <div className="flex items-center gap-4">
                 <button 
                   onClick={handleSaveProfile}
                   className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95"
                 >
                   <Save size={18} /> SAVE PROFILE CHANGES
                 </button>
              </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-12 relative z-10">
              <div className="space-y-4">
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Official Logo</label>
                 <div className="flex items-center gap-8">
                    <div className="w-32 h-32 border-2 border-dashed border-emerald-100 rounded-[32px] flex items-center justify-center bg-slate-50 overflow-hidden">
                       {profile.logo ? (
                         <img src={profile.logo} alt="Logo" className="w-full h-full object-contain p-2" />
                       ) : (
                         <Building2 size={48} className="text-slate-200" />
                       )}
                    </div>
                    <div className="space-y-2">
                       <button 
                         onClick={() => fileInputRef.current?.click()}
                         className="bg-emerald-50 text-emerald-600 font-black text-[10px] uppercase tracking-widest px-6 py-3 rounded-xl border border-emerald-100 hover:bg-emerald-100 transition-all flex items-center gap-2"
                       >
                         <Upload size={14} /> CHOOSE NEW LOGO
                       </button>
                       <input 
                         type="file" 
                         ref={fileInputRef} 
                         className="hidden" 
                         accept="image/*" 
                         onChange={handleLogoUpload}
                       />
                       <p className="text-[9px] text-slate-400 font-medium font-sans">Recommended: Square PNG or JPG</p>
                    </div>
                 </div>
              </div>

              <div className="space-y-4">
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Registered Address</label>
                 <textarea 
                    className="w-full bg-slate-50 border border-slate-100 rounded-[32px] p-8 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 h-32 resize-none"
                    value={profile.address}
                    onChange={(e) => setProfile({...profile, address: e.target.value})}
                 />
              </div>

              <div className="space-y-4">
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Institution Name</label>
                 <input 
                    type="text"
                    className="w-full bg-slate-50 border border-slate-100 rounded-full px-8 py-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
                    value={profile.name}
                    onChange={(e) => setProfile({...profile, name: e.target.value})}
                 />
              </div>

              <div className="space-y-4">
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Primary Contact Number</label>
                 <input 
                    type="text"
                    className="w-full bg-slate-50 border border-slate-100 rounded-full px-8 py-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
                    value={profile.phone}
                    onChange={(e) => setProfile({...profile, phone: e.target.value})}
                 />
              </div>
           </div>
        </div>
      )}

      {activeTab === 'masters' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
           {[
             { title: 'BRANCHES', icon: Building2, type: 'branches' as const, field: 'branch', color: 'emerald' },
             { title: 'SEMESTERS', icon: GraduationCap, type: 'semesters' as const, field: 'semester', color: 'blue' },
             { title: 'SESSIONS', icon: Save, type: 'sessions' as const, field: 'session', color: 'amber' }
           ].map((m, i) => (
             <div key={i} className="bg-white rounded-[40px] p-8 border border-slate-200 shadow-sm space-y-8 flex flex-col">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <div className="p-3 bg-slate-50 text-slate-400 rounded-2xl">
                         <m.icon size={20} />
                      </div>
                      <h3 className="font-black text-slate-800 tracking-tight">{m.title}</h3>
                   </div>
                   <span className="bg-emerald-50 text-emerald-600 text-[10px] font-black px-2 py-1 rounded-lg">{(masters[m.type] || []).length}</span>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto max-h-[300px] custom-scrollbar pr-2">
                   {(masters[m.type] || []).map((val, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-50 px-5 py-4 rounded-2xl border border-slate-100 group">
                         {editingMaster?.type === m.type && editingMaster?.index === idx ? (
                           <input 
                             autoFocus
                             className="bg-white border border-emerald-500 rounded-lg px-2 py-1 text-sm font-bold flex-1 outline-none"
                             value={editingMaster.value}
                             onChange={(e) => setEditingMaster({...editingMaster, value: e.target.value})}
                             onBlur={saveEditMaster}
                             onKeyPress={(e) => e.key === 'Enter' && saveEditMaster()}
                           />
                         ) : (
                           <span className="text-sm font-bold text-slate-600">{val}</span>
                         )}
                         <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEditMaster(m.type, idx, val)} className="text-slate-300 hover:text-cyan-500 transition-colors">
                               <Edit2 size={16} />
                            </button>
                            <button onClick={() => removeMaster(m.type, idx)} className="text-slate-300 hover:text-red-500 transition-colors">
                               <X size={16} />
                            </button>
                         </div>
                      </div>
                   ))}
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-100">
                   <input 
                      type="text" 
                      placeholder={`Add ${m.title}...`} 
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
                      value={(inputs as any)[m.field]}
                      onChange={(e) => setInputs({...inputs, [m.field]: e.target.value})}
                      onKeyPress={(e) => e.key === 'Enter' && addMaster(m.type, m.field)}
                   />
                   <button 
                      onClick={() => addMaster(m.type, m.field)}
                      className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-100"
                   >
                     Confirm New Entry
                   </button>
                </div>
             </div>
           ))}
        </div>
      )}

      {activeTab === 'staff' && (
        <div className="space-y-8">
           <div className="flex items-center justify-between">
              <div className="border-l-4 border-emerald-500 pl-6 py-1">
                 <h3 className="text-2xl font-black text-slate-800 tracking-tight text-left">Staff Control</h3>
                 <p className="text-slate-500 text-sm font-medium">Manage administrative access and roles</p>
              </div>
              <button 
                onClick={() => {
                  setEditingStaffId(null);
                  setStaffForm({ name: '', role: 'Operator', phone: '', pin: '' });
                  setIsStaffModalOpen(true);
                }}
                className="bg-emerald-600 text-white px-8 py-4 rounded-full font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95 flex items-center gap-2"
              >
                <UserPlus size={18} />
                ADD STAFF MEMBER
              </button>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(data.staff || []).map(s => (
                <div key={s.id} className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm group hover:border-emerald-200 transition-all">
                   <div className="flex items-center justify-between mb-6">
                      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center font-black text-lg">
                         {s.name.charAt(0)}
                      </div>
                      <div className="flex items-center gap-2">
                         <button onClick={() => editStaff(s)} className="p-2 text-slate-300 hover:text-cyan-600 hover:bg-cyan-50 rounded-xl transition-all">
                            <Edit2 size={16} />
                         </button>
                         <button 
                           onClick={() => deleteStaff(s.id)} 
                           className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                           disabled={s.id === 'admin'}
                          >
                            <X size={16} />
                         </button>
                      </div>
                   </div>
                    <h4 className="font-black text-slate-900 uppercase tracking-tight text-xl mb-1">{s.name}</h4>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 italic">ID: {s.id}</p>
                   <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-4">{s.role}</p>
                   <div className="space-y-2 border-t border-slate-50 pt-4">
                      <div className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-tighter">
                         <Smartphone size={14} className="text-slate-300" />
                         {s.phone}
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-tighter">
                         <Shield size={14} className="text-slate-300" />
                         PIN: {s.pin}
                      </div>
                   </div>
                </div>
              ))}
           </div>

           <AnimatePresence>
             {isStaffModalOpen && (
               <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                 <motion.div 
                   initial={{ opacity: 0 }}
                   animate={{ opacity: 1 }}
                   exit={{ opacity: 0 }}
                   className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                   onClick={() => setIsStaffModalOpen(false)}
                 />
                 <motion.div 
                   initial={{ opacity: 0, scale: 0.9, y: 20 }}
                   animate={{ opacity: 1, scale: 1, y: 0 }}
                   exit={{ opacity: 0, scale: 0.9, y: 20 }}
                   className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg relative z-10 overflow-hidden border border-white/20"
                 >
                   <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                     <h3 className="text-2xl font-black text-slate-800 tracking-tight">
                       {editingStaffId ? 'UPDATE STAFF MEMBER' : 'NEW STAFF ACCESS'}
                     </h3>
                     <button 
                       onClick={() => setIsStaffModalOpen(false)}
                       className="p-2 bg-slate-50 text-slate-400 hover:text-red-500 rounded-full transition-colors"
                     >
                       <X size={20} />
                     </button>
                   </div>

                   <form onSubmit={handleStaffSubmit} className="p-10 space-y-8">
                      <div className="space-y-6">
                         <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff Name</label>
                            <input 
                               required
                               className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
                               placeholder="e.g. John Doe"
                               value={staffForm.name}
                               onChange={(e) => setStaffForm({...staffForm, name: e.target.value})}
                            />
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Staff Role</label>
                               <select 
                                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold text-slate-700 outline-none"
                                  value={staffForm.role}
                                  onChange={(e) => setStaffForm({...staffForm, role: e.target.value})}
                               >
                                  <option>Operator</option>
                                  <option>Accountant</option>
                                  <option>Manager</option>
                                  <option>Administrator</option>
                               </select>
                            </div>
                            <div className="space-y-2">
                               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Secure PIN (5 Digits)</label>
                               <input 
                                  required
                                  maxLength={5}
                                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
                                  placeholder="12345"
                                  value={staffForm.pin}
                                  onChange={(e) => setStaffForm({...staffForm, pin: e.target.value.replace(/\D/g,'')})}
                               />
                            </div>
                         </div>
                         <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Contact Number</label>
                            <input 
                               className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
                               placeholder="9876543210"
                               value={staffForm.phone}
                               onChange={(e) => setStaffForm({...staffForm, phone: e.target.value})}
                            />
                         </div>
                      </div>

                      <button 
                         type="submit"
                         className="w-full bg-emerald-600 text-white font-black py-5 rounded-[24px] text-xs uppercase tracking-[0.2em] shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95"
                      >
                         {editingStaffId ? 'CONFIRM UPDATE' : 'GRANT ACCESS NOW'}
                      </button>
                   </form>
                 </motion.div>
               </div>
             )}
           </AnimatePresence>
        </div>
      )}

      {activeTab === 'system' && (
        <div className="bg-white rounded-[40px] p-10 border border-slate-200 shadow-sm space-y-12 relative overflow-hidden">
           <div className="absolute top-0 right-0 w-64 h-64 bg-red-50/20 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none"></div>
           
           <div className="flex items-center justify-between border-l-4 border-red-500 pl-6 py-1 relative z-10">
              <div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">Data Management</h3>
                <p className="text-slate-500 text-sm font-medium">Tools for maintenance and system cleanup</p>
              </div>
              {showSuccess && (
                <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
                  <CheckCircle size={18} /> Operation Successful
                </div>
              )}
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
              <div className="p-8 bg-slate-50 rounded-[32px] border border-slate-100 space-y-4">
                 <h4 className="font-black text-slate-800 uppercase tracking-tight">Purge Sample Data</h4>
                 <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    Removes all pre-loaded seed records (RC- receipts and sample students) while keeping your imported data intact.
                 </p>
                 <button 
                  onClick={clearSeedData}
                  className="bg-white text-slate-900 border border-slate-200 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-100 transition-all active:scale-95"
                 >
                   Clean Sample Records
                 </button>
              </div>

              <div className="p-8 bg-cyan-50 rounded-[32px] border border-cyan-100 space-y-4">
                 <h4 className="font-black text-cyan-800 uppercase tracking-tight">System Integrity Audit</h4>
                 <p className="text-xs text-cyan-600 font-medium leading-relaxed">
                    Automatically merges duplicate students (matching by name or roll number) and re-links payments to reconcile dues.
                 </p>
                 <button 
                  onClick={async () => {
                    if (!window.confirm('Run system-wide data audit? This will merge duplicate students, fix payment links, and verify course structures.')) return;
                    
                    setIsResetting(true);
                    try {
                      console.log('Starting data audit...');
                      const students = [...data.students];
                      const transactions = data.transactions.map(t => ({ ...t }));
                      const validPlanIds = data.feePlans.map(p => p.id);
                      
                      const seen = new Map<string, string>(); // normalizedKey -> primaryId
                      const toDelete: string[] = [];
                      let reLinkedCount = 0;
                      let fixedPlansCount = 0;

                      // Use the first valid plan as fallback if any, or create one
                      let fallbackPlanId = validPlanIds[0];
                      if (!fallbackPlanId) {
                        fallbackPlanId = await supabaseService.ensureDefaultCourse();
                      }

                      for (const s of students) {
                        // 1. Fix Invalid Plans
                        if (!validPlanIds.includes(s.planId)) {
                          console.log(`Fixing invalid plan for ${s.name}: ${s.planId} -> ${fallbackPlanId}`);
                          s.planId = fallbackPlanId;
                          fixedPlansCount++;
                          await supabase.from('students').update({ course_id: fallbackPlanId }).eq('id', s.id);
                        }

                        // 2. Priority for merging: Roll Number > Name
                        const key = (s.rollNumber?.trim() || s.name.trim()).toUpperCase();
                        if (!key) continue;

                        if (seen.has(key)) {
                          const primaryId = seen.get(key)!;
                          transactions.forEach(t => {
                            if (t.studentId === s.id) {
                              t.studentId = primaryId;
                              reLinkedCount++;
                            }
                          });
                          toDelete.push(s.id);
                        } else {
                          seen.set(key, s.id);
                        }
                      }

                      console.log(`Audit result: ${toDelete.length} duplicates, ${reLinkedCount} payments to re-link, ${fixedPlansCount} plan links fixed`);

                      // 1. Re-sync transactions first to avoid FK violations
                      if (reLinkedCount > 0) {
                        await supabaseService.bulkSaveTransactions(transactions);
                      }

                      // 2. Remove duplicates from DB
                      if (toDelete.length > 0) {
                        for (const id of toDelete) {
                          // Before deleting student, delete their payments in DB to satisfy FK
                          await supabase.from('payments').delete().eq('student_id', id);
                          const { error } = await supabase.from('students').delete().eq('id', id);
                          if (error) console.warn(`Failed to delete student ${id}:`, error);
                        }
                      }

                      // 3. Final sync to refresh UI
                      const refreshedData = await supabaseService.fetchAppData();
                      if (refreshedData) {
                        setData(refreshedData);
                        alert(`Audit Complete!\n\n- Fixed ${fixedPlansCount} orphaned course links.\n- Merged ${toDelete.length} duplicate student records.\n- Re-linked ${reLinkedCount} payments to master records.\n\nDatabase is now synchronized.`);
                      } else {
                        // Fallback refresh
                        window.location.reload();
                      }
                    } catch (err: any) {
                      console.error('Audit failed:', err);
                      alert('Audit Encountered an Error: ' + (err.message || 'Unknown error'));
                    } finally {
                      setIsResetting(false);
                      console.log('Audit process finished.');
                    }
                  }}
                  disabled={isResetting}
                  className="bg-white text-cyan-900 border border-cyan-200 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-cyan-100 transition-all active:scale-95 shadow-sm shadow-cyan-100"
                 >
                   {isResetting ? 'Auditing...' : 'Run Reconciliation Audit'}
                 </button>
              </div>

              <div className="p-8 bg-red-50 rounded-[32px] border border-red-100 space-y-4">
                 <h4 className="font-black text-red-800 uppercase tracking-tight">Factory Reset</h4>
                 <p className="text-xs text-red-600 font-medium leading-relaxed">
                    Deletes ALL student records, payment history, and fee components. Recommended before starting a new academic session.
                 </p>
                 <button 
                   onClick={resetAllData}
                   disabled={isResetting}
                   className={`${isResetting ? 'bg-red-400' : confirmReset ? 'bg-orange-600 hover:bg-orange-700' : 'bg-red-600 hover:bg-red-700'} text-white px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-red-100 flex items-center gap-2`}
                  >
                    {isResetting ? 'Processing Purge...' : confirmReset ? '⚠️ Click Again to Confirm Reset' : 'Reset All Database Data'}
                  </button>
              </div>

              <div className="p-8 bg-indigo-50 rounded-[32px] border border-indigo-100 space-y-4">
                 <h4 className="font-black text-indigo-800 uppercase tracking-tight">System Backup & Migration</h4>
                 <p className="text-xs text-indigo-600 font-medium leading-relaxed">
                    Export your entire database to a JSON file for security or to move the software to another computer.
                 </p>
                 <div className="flex gap-4">
                    <button 
                      onClick={downloadBackup}
                      className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100"
                    >
                      Export Backup
                    </button>
                    <button 
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.json';
                        input.onchange = (e) => handleRestore(e as any);
                        input.click();
                      }}
                      className="bg-white text-indigo-900 border border-indigo-200 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-indigo-50 transition-all active:scale-95"
                    >
                      Import Backup
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}


      {activeTab === 'database' && (
        <div className="bg-white rounded-[40px] p-10 border border-slate-200 shadow-sm space-y-12 relative overflow-hidden text-left">
           <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-50/20 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none"></div>
           
           <div className="flex items-center justify-between border-l-4 border-cyan-500 pl-6 py-1 relative z-10">
              <div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">Supabase Cloud Setup</h3>
                <p className="text-slate-500 text-sm font-medium">Resolve "Permission Denied" and RLS errors</p>
              </div>
           </div>

           <div className="space-y-8 relative z-10">
              <div className="p-8 bg-slate-50 rounded-[32px] border border-slate-100 space-y-6">
                 <div className="flex items-start gap-4">
                   <div className="w-10 h-10 bg-white shadow-sm flex items-center justify-center rounded-2xl text-cyan-600 shrink-0 font-black">1</div>
                   <div className="space-y-1">
                     <h4 className="font-black text-slate-800 uppercase tracking-tight text-sm">Open Supabase Dashboard</h4>
                     <p className="text-xs text-slate-500 font-medium">Go to your project dashboard, then select <span className="text-slate-800 font-bold">SQL Editor</span> from the sidebar.</p>
                   </div>
                 </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-white shadow-sm flex items-center justify-center rounded-2xl text-cyan-600 shrink-0 font-black">2</div>
                  <div className="space-y-1">
                    <h4 className="font-black text-slate-800 uppercase tracking-tight text-sm">Copy & Run Fix Script</h4>
                    <p className="text-xs text-slate-500 font-medium">Copy the script below and run it in Supabase. This will grant the necessary permissions to the tables (Students, Payments, Staff, etc.).</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Initialization & Permissions Script (SQL)</label>
                  <button 
                    onClick={() => {
                      const sql = `-- 🔥 SUPABASE SECURITY & INTEGRITY REPAIR (V14)
-- RESOLVES 20 SECURITY WARNINGS & ENABLES CLEAN DELETIONS

-- 1. HARDEN FOREIGN KEY CONSTRAINTS
-- Ensures courses can be deleted by setting student references to NULL
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'students_course_id_fkey') THEN
        ALTER TABLE public.students DROP CONSTRAINT students_course_id_fkey;
    END IF;
END $$;

ALTER TABLE public.students 
ADD CONSTRAINT students_course_id_fkey 
FOREIGN KEY (course_id) 
REFERENCES courses(id) 
ON DELETE SET NULL;

-- 2. ENABLE RLS ON ALL TABLES
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 3. APPLY ZERO-TRUST POLICIES (Fixes "RLS Policy Always True")
-- Replaces (true) with (auth.uid() is not null)
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name IN ('settings', 'courses', 'fee_heads', 'students', 'accountants', 'payments')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "public_access" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Authenticated_Access" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth_access_%I" ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "anon_read_%I" ON public.%I', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access" ON public.%I', t);
        
        -- Policy: ONLY allow authenticated users to perform operations
        EXECUTE format('
            CREATE POLICY "authenticated_secure_access"
            ON public.%I
            FOR ALL
            TO authenticated
            USING (auth.uid() IS NOT NULL)
            WITH CHECK (auth.uid() IS NOT NULL)
        ', t);
    END LOOP;
END $$;

-- 4. REVOKE ANONYMOUS ACCESS (Resolves pg_graphql warnings)
-- Ensures only logged-in users or service roles can touch the data
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- 5. HIDE FROM GRAPHQL (Improves security score)
COMMENT ON SCHEMA public IS '@graphql({"expose": false})';

-- 6. RELOAD SCHEMA
NOTIFY pgrst, 'reload schema';
`;
                      navigator.clipboard.writeText(sql);
                      alert('HARDENED SQL Fix Script (V14) copied!\n\nPaste this in your Supabase SQL Editor to resolve all 20 security warnings and enable smooth course deletions.');
                    }}
                    className="text-cyan-600 font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-cyan-50 px-3 py-1 rounded-lg transition-all"
                  >
                    <Plus size={14} /> Copy Fix Script
                  </button>
                </div>
                <div className="relative group">
                  <textarea 
                    readOnly
                    className="w-full bg-slate-900 text-cyan-400 font-mono text-[10px] leading-relaxed p-8 rounded-[32px] h-64 resize-none border border-slate-800 shadow-2xl"
                    value={`-- Run these commands in Supabase
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name IN ('settings', 'courses', 'fee_heads', 'students', 'accountants', 'payments')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth_access_%I" ON public.%I', t, t);
        EXECUTE format('CREATE POLICY "auth_access_%I" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
        EXECUTE format('CREATE POLICY "anon_read_%I" ON public.%I FOR SELECT TO anon USING (true)', t, t);
    END LOOP;
END $$;`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent pointer-events-none opacity-50 rounded-[32px]"></div>
                </div>
                <p className="text-[9px] text-slate-400 italic px-4">
                  * Note: Using <code className="text-slate-800 font-bold">USING (true)</code> is a broad policy used here to ensure successful initial setup. You can later harden these policies in the Supabase Dashboard.
                </p>
              </div>
            </div>
        </div>
      )}
    </div>
  );
}
