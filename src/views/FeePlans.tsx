import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, Wallet, Download } from 'lucide-react';
import { AppData, FeePlan, FeeComponent } from '../types';
import * as XLSX from 'xlsx';
import { supabaseService } from '../services/supabaseService';
import { supabase } from '../lib/supabase';

interface FeePlansProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  setIsRefreshing?: (val: boolean) => void;
}

export default function FeePlans({ data, setData, setIsRefreshing }: FeePlansProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState<Partial<FeePlan>>({
    name: '',
    frequency: 'Yearly',
    components: [],
  });
  const [currentComponent, setCurrentComponent] = useState<{name: string, amount: number, base: string}>({
    name: '',
    amount: 0,
    base: 'Base'
  });

  const handleAddComponent = () => {
    if (currentComponent.name && currentComponent.amount) {
      setNewPlan(prev => ({
        ...prev,
        components: [...(prev.components || []), {
          id: Math.random().toString(36).substr(2, 9),
          name: currentComponent.base === 'Base' ? currentComponent.name : `${currentComponent.name} (${currentComponent.base})`,
          amount: Number(currentComponent.amount)
        }]
      }));
      setCurrentComponent({ name: '', amount: 0, base: 'Base' });
    }
  };

  const removeComponent = (id: string) => {
    setNewPlan(prev => ({
      ...prev,
      components: prev.components?.filter(c => c.id !== id)
    }));
  };

  const totalAmount = newPlan.components?.reduce((sum, c) => sum + c.amount, 0) || 0;

  const handleEditPlan = (plan: FeePlan) => {
    setEditingPlanId(plan.id);
    setNewPlan({
      name: plan.name,
      frequency: plan.frequency,
      components: [...plan.components],
    });
    setIsModalOpen(true);
  };

  const handleSavePlan = async () => {
    if (newPlan.name && newPlan.components?.length) {
      let finalPlan: FeePlan;
      if (editingPlanId) {
        finalPlan = {
          id: editingPlanId,
          name: newPlan.name!,
          frequency: newPlan.frequency as 'Semester' | 'Yearly',
          components: newPlan.components!,
          totalAmount
        };
        setData(prev => ({
          ...prev,
          feePlans: prev.feePlans.map(p => p.id === editingPlanId ? finalPlan : p)
        }));
      } else {
        finalPlan = {
          id: Math.random().toString(36).substr(2, 9),
          name: newPlan.name,
          frequency: newPlan.frequency as 'Semester' | 'Yearly',
          components: newPlan.components,
          totalAmount
        };
        setData(prev => ({
          ...prev,
          feePlans: [finalPlan, ...prev.feePlans]
        }));
      }

      // Sync to Supabase
      await supabaseService.saveFeePlan(finalPlan);

      resetModal();
    }
  };

  const resetModal = () => {
    setNewPlan({ name: '', frequency: 'Yearly', components: [] });
    setEditingPlanId(null);
    setIsModalOpen(false);
  };

  const handleDeletePlan = async (id: string) => {
    // 1. Identify students affected by this deletion
    const studentsUsingPlan = data.students.filter(s => s.planId === id);
    
    // 2. Identify an alternative "Default" course to move them to
    const fallbackPlan = data.feePlans.find(p => p.id !== id);
    
    if (studentsUsingPlan.length > 0) {
      if (!fallbackPlan) {
        alert(`CANNOT DELETE: This is the only fee plan available and ${studentsUsingPlan.length} students are enrolled in it. Please create a new plan first so you can move students to it.`);
        return;
      }

      const confirmMove = window.confirm(
        `CONSTRAINTS DETECTED: This fee plan is currently used by ${studentsUsingPlan.length} student(s).\n\n` +
        `To delete this plan, these students must be reassigned. Would you like to automatically move them to the "${fallbackPlan.name}" plan?`
      );

      if (!confirmMove) return;

      try {
        if (setIsRefreshing) setIsRefreshing(true);
        
        console.log(`[Supabase] Reassigning ${studentsUsingPlan.length} students to ${fallbackPlan.name}...`);
        
        // Update students in DB first
        const { error: moveError } = await supabase
          .from('students')
          .update({ course_id: fallbackPlan.id })
          .eq('course_id', id);

        if (moveError) {
          throw new Error(`Failed to move students: ${moveError.message}`);
        }

        // Update local state for students
        setData(prev => ({
          ...prev,
          students: prev.students.map(s => s.planId === id ? { ...s, planId: fallbackPlan.id } : s)
        }));
      } catch (err: any) {
        alert('Data migration failed: ' + err.message);
        if (setIsRefreshing) setIsRefreshing(false);
        return;
      }
    }

    // 3. Proceed with deletion
    if (window.confirm('Are you sure you want to permanently delete this fee plan? All associated fee components will also be removed.')) {
      try {
        if (setIsRefreshing) setIsRefreshing(true);
        
        // Delete from Supabase
        const { error } = await supabase.from('courses').delete().eq('id', id);
        
        if (error) {
          if (error.code === '23503') {
            alert('Cloud security prevented deletion: Direct dependencies still exist. Please try syncing data first.');
          } else {
            console.error('Delete error details:', error);
            alert('Failed to delete course from cloud: ' + error.message);
          }
        } else {
          // Update local state
          setData(prev => ({
            ...prev,
            feePlans: prev.feePlans.filter(p => p.id !== id)
          }));
          console.log('[Supabase] Fee plan deleted successfully:', id);
        }
      } catch (err: any) {
        alert('An unexpected system error occurred during deletion.');
        console.error(err);
      } finally {
        if (setIsRefreshing) setIsRefreshing(false);
      }
    }
  };

  const handleDownload = () => {
    const exportData = data.feePlans.map(p => ({
      'Plan Name': p.name,
      'Frequency': p.frequency,
      'Total Amount': p.totalAmount,
      'Components': p.components.map(c => `${c.name}: ${c.amount}`).join('; ')
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fee Plans");
    XLSX.writeFile(wb, `Fee_Structures_${new Date().toLocaleDateString()}.xlsx`);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-black text-slate-800 tracking-tight">Fee Plans</h2>
          <p className="text-slate-500 font-medium tracking-tight">Manage fee structures and installment plans</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={handleDownload}
            className="flex items-center gap-2 bg-white text-blue-600 border-2 border-blue-50 px-8 py-4 rounded-full font-bold shadow-sm hover:bg-blue-50 transition-all active:scale-95"
          >
            <Download size={20} />
            Export Plans
          </button>
          <button 
            onClick={() => {
              resetModal();
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-emerald-600 text-white px-8 py-4 rounded-full font-bold shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95"
          >
            <Plus size={20} />
            Create Plan
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-8 py-5 text-sm font-black text-slate-900 uppercase tracking-widest w-24">ID</th>
              <th className="px-8 py-5 text-sm font-black text-slate-900 uppercase tracking-widest">Plan Name</th>
              <th className="px-8 py-5 text-sm font-black text-slate-900 uppercase tracking-widest">Frequency</th>
              <th className="px-8 py-5 text-sm font-black text-slate-900 uppercase tracking-widest">Total</th>
              <th className="px-8 py-5 text-sm font-black text-slate-900 uppercase tracking-widest">Components</th>
              <th className="px-8 py-5 text-sm font-black text-slate-900 uppercase tracking-widest w-48">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.feePlans.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-8 py-20 text-center text-slate-300">
                  <div className="flex flex-col items-center justify-center">
                    <Wallet size={48} className="mb-4 opacity-10" />
                    <p className="font-bold uppercase tracking-widest opacity-40">No plans defined yet</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.feePlans.map((plan, index) => (
                <tr key={plan.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5 font-bold text-slate-600">{index + 1}</td>
                  <td className="px-8 py-5 font-bold text-slate-800">{plan.name}</td>
                  <td className="px-8 py-5 font-bold text-slate-600 italic">{plan.frequency}</td>
                  <td className="px-8 py-5 font-bold text-slate-900 text-lg">₹{plan.totalAmount.toLocaleString()}</td>
                  <td className="px-8 py-5 bg-slate-50/30">
                    <div className="space-y-1.5">
                      {plan.components.map((c, ci) => (
                        <div key={ci} className="text-[10px] text-slate-500 font-black uppercase flex justify-between border-b border-white pb-1">
                          <span>{c.name}</span>
                          <span className="text-slate-800">₹{c.amount.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                       <button 
                        onClick={() => handleEditPlan(plan)}
                        className="flex-1 bg-cyan-600 text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-cyan-700 transition-all shadow-lg shadow-cyan-100 active:scale-95"
                       >
                         Edit Plan
                       </button>
                       <button 
                        onClick={() => handleDeletePlan(plan.id)}
                        className="bg-rose-100 text-rose-600 p-2.5 rounded-xl hover:bg-rose-600 hover:text-white transition-all active:scale-95 group"
                        title="Delete Plan"
                       >
                         <Trash2 size={18} className="group-hover:scale-110 transition-transform" />
                       </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-12">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={resetModal}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg relative z-10 overflow-hidden border border-white/20"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-2xl font-bold text-slate-800">{editingPlanId ? 'Edit Structure' : 'New Structure'}</h3>
                <button 
                  onClick={resetModal}
                  className="p-2 bg-slate-50 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-8">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Plan Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Master of Science" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newPlan.name}
                      onChange={(e) => setNewPlan({...newPlan, name: e.target.value})}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Installment Frequency</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newPlan.frequency}
                      onChange={(e) => setNewPlan({...newPlan, frequency: e.target.value as any})}
                    >
                      <option>Semester</option>
                      <option>Yearly</option>
                    </select>
                  </div>
                </div>

                <div className="bg-white border border-emerald-100 p-8 rounded-[32px] relative overflow-hidden group">
                  <div className="absolute inset-0 bg-emerald-50/10 group-hover:bg-emerald-50/20 transition-colors" />
                  <div className="relative z-10">
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-6 ml-1">Add Component</p>
                    <div className="flex gap-2 mb-6">
                      <input 
                        type="text" 
                        placeholder="Head Name" 
                        className="flex-[2] bg-white border border-slate-100 rounded-2xl px-5 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        value={currentComponent.name}
                        onChange={(e) => setCurrentComponent({...currentComponent, name: e.target.value})}
                      />
                      <input 
                        type="number" 
                        placeholder="Amt ₹" 
                        className="flex-1 bg-white border border-slate-100 rounded-2xl px-5 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        value={currentComponent.amount || ''}
                        onChange={(e) => setCurrentComponent({...currentComponent, amount: Number(e.target.value)})}
                      />
                      <select 
                        className="flex-1 bg-white border border-slate-100 rounded-2xl px-5 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        value={currentComponent.base}
                        onChange={(e) => setCurrentComponent({...currentComponent, base: e.target.value})}
                      >
                        <option>Base</option>
                        <option>Annual</option>
                        <option>One-time</option>
                        <option>Recurring</option>
                      </select>
                    </div>
                    <button 
                      onClick={handleAddComponent}
                      className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl text-xs uppercase tracking-[0.2em] shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95"
                    >
                      + APPEND HEAD
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {newPlan.components?.map((c) => (
                    <div key={c.id} className="flex items-center justify-between bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                      <span className="text-sm font-bold text-slate-700">{c.name}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-black text-emerald-600">₹{c.amount.toLocaleString()}</span>
                        <button onClick={() => removeComponent(c.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 p-8 flex items-center justify-between">
                <div className="flex gap-4">
                  <button 
                    onClick={resetModal}
                    className="bg-slate-800 text-white font-black px-6 py-4 rounded-2xl hover:bg-slate-700 transition-all active:scale-95 text-xs uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                  <div>
                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Estimated Total</p>
                    <p className="text-3xl font-black text-white">₹{totalAmount.toLocaleString()}</p>
                  </div>
                </div>
                <button 
                  onClick={handleSavePlan}
                  className="bg-white text-slate-900 font-black px-8 py-4 rounded-2xl hover:bg-emerald-50 transition-all active:scale-95"
                >
                  {editingPlanId ? 'SAVE CHANGES' : 'CONFIRM PLAN'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
