import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Search, MoreVertical, GraduationCap, Phone, MapPin, Upload, IndianRupee, Download, Trash2, FileText } from 'lucide-react';
import { AppData, Student } from '../types';
import * as XLSX from 'xlsx';
import { supabaseService } from '../services/supabaseService';
import { supabase } from '../lib/supabase';

interface StudentsProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
}

export default function Students({ data, setData }: StudentsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [importMode, setImportMode] = useState<'upload' | 'paste'>('upload');
  const [newStudent, setNewStudent] = useState<Partial<Student>>({
    name: '',
    guardianName: '',
    planId: '',
    branch: '',
    semester: '',
    session: data.masters.sessions[0] || '',
    rollNumber: '',
    phone: '',
    email: '',
  });

  const openEnrollModal = () => {
    setEditingStudent(null);
    setNewStudent({
      name: '',
      guardianName: '',
      planId: '',
      branch: '',
      semester: '',
      session: data.masters.sessions[0] || '',
      rollNumber: '',
      phone: '',
      email: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setNewStudent({ ...student });
    setIsModalOpen(true);
  };

  const filteredStudents = useMemo(() => {
    return data.students.filter(s => {
      const name = s.name?.toLowerCase() || '';
      const roll = s.rollNumber?.toLowerCase() || '';
      const search = searchTerm.toLowerCase();
      return name.includes(search) || roll.includes(search);
    });
  }, [data.students, searchTerm]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newStudent.name && newStudent.planId && newStudent.rollNumber) {
      let finalStudent: Student;
      if (editingStudent) {
        finalStudent = { ...editingStudent, ...(newStudent as Student) };
        setData(prev => ({
          ...prev,
          students: prev.students.map(s => s.id === editingStudent.id ? finalStudent : s)
        }));
      } else {
        finalStudent = {
          ...(newStudent as Student),
          id: crypto.randomUUID(),
          enrollmentDate: new Date().toISOString(),
        };
        setData(prev => ({
          ...prev,
          students: [...prev.students, finalStudent]
        }));
      }

      // Sync to Supabase
      await supabaseService.saveStudent(finalStudent);

      setIsModalOpen(false);
      setEditingStudent(null);
    }
  };

  const handleBulkImportStudents = (students: Student[]) => {
    if (students.length > 0) {
      supabaseService.bulkSaveStudents(students)
        .then(() => console.log('Bulk student sync successful'))
        .catch(err => console.error('Bulk student import failed:', err));

      setData(prev => ({
        ...prev,
        students: [...prev.students, ...students]
      }));
      alert(`Successfully imported ${students.length} students.`);
      setIsImportModalOpen(false);
      setPasteData('');
    }
  };

  const parseStudentData = (items: any[][]) => {
    if (items.length === 0) return [];

    let headerRowIndex = -1;
    let headers: string[] = [];

    // Try to find the header row (some row that contains "name", "roll", or "plan")
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const rowStr = items[i].join(' ').toLowerCase();
      if (rowStr.includes('name') || rowStr.includes('roll') || rowStr.includes('id') || rowStr.includes('student')) {
        headerRowIndex = i;
        headers = items[i].map(h => String(h).toLowerCase().trim());
        break;
      }
    }

    let dataRows = items;
    let nameIdx = 0;
    let rollIdx = 1;
    let planIdx = 2;
    let branchIdx = 3;
    let semIdx = 4;
    let sessionIdx = 5;
    let guardianIdx = -1;
    let phoneIdx = -1;
    let emailIdx = -1;

    if (headerRowIndex !== -1) {
      nameIdx = headers.findIndex(h => h.includes('name'));
      rollIdx = headers.findIndex(h => h.includes('roll') || h.includes('id'));
      planIdx = headers.findIndex(h => h.includes('plan') || h.includes('course') || h.includes('program'));
      branchIdx = headers.findIndex(h => h.includes('branch'));
      semIdx = headers.findIndex(h => h.includes('sem'));
      sessionIdx = headers.findIndex(h => h.includes('session') || h.includes('year'));
      guardianIdx = headers.findIndex(h => h.includes('guardian') || h.includes('father'));
      phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('contact'));
      emailIdx = headers.findIndex(h => h.includes('email'));
      dataRows = items.slice(headerRowIndex + 1);
    } else if (items[0].length >= 4) {
       // Guessing format: Name, Roll, Plan, Branch...
       nameIdx = 0; rollIdx = 1; planIdx = 2; branchIdx = 3;
    }

    const importedStudents: Student[] = dataRows.map((row, idx) => {
      if (!row || row.length === 0) return null;
      
      const name = String(row[nameIdx] || '').trim();
      if (!name || name.toLowerCase() === 'name' || name.toLowerCase() === 'student') return null;

      const planName = planIdx !== -1 && row[planIdx] ? String(row[planIdx]).trim() : '';
      const plan = data.feePlans.find(p => p.name.toLowerCase().trim() === planName.toLowerCase());
      
      return {
        id: crypto.randomUUID(),
        name: name,
        guardianName: guardianIdx !== -1 && row[guardianIdx] ? String(row[guardianIdx]).trim() : '',
        planId: plan ? plan.id : (data.feePlans[0]?.id || 'unknown'),
        branch: branchIdx !== -1 && row[branchIdx] ? String(row[branchIdx]).trim() : (data.masters.branches[0] || 'General'),
        semester: semIdx !== -1 && row[semIdx] ? String(row[semIdx]).trim() : (data.masters.semesters[0] || 'I'),
        session: sessionIdx !== -1 && row[sessionIdx] ? String(row[sessionIdx]).trim() : (data.masters.sessions[0] || '2024-25'),
        rollNumber: rollIdx !== -1 && row[rollIdx] ? String(row[rollIdx]).trim() : `IMP-${Date.now().toString().slice(-4)}-${idx}`,
        phone: phoneIdx !== -1 && row[phoneIdx] ? String(row[phoneIdx]).trim() : '',
        email: emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).trim() : '',
        enrollmentDate: new Date().toISOString()
      };
    }).filter(Boolean) as Student[];

    return importedStudents;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        const imported = parseStudentData(rows);
        if (imported.length > 0) {
          handleBulkImportStudents(imported);
        } else {
          alert('No valid student data found. Please check your file content and headers.');
        }
      } catch (err) {
        alert('Failed to parse file.');
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopyPasteImport = () => {
    if (!pasteData.trim()) return;
    
    const lines = pasteData.trim().split('\n');
    const items = lines.map(line => {
      if (line.includes('\t')) return line.split('\t');
      if (line.includes(',')) return line.split(',').map(s => s.trim());
      if (line.includes('  ')) return line.split(/\s{2,}/).map(s => s.trim());
      return line.split(',').map(s => s.trim());
    });

    const imported = parseStudentData(items);
    if (imported.length > 0) {
      handleBulkImportStudents(imported);
    } else {
      alert('No valid student data found in pasted text.');
    }
  };

  const handleDownload = () => {
    const exportData = data.students.map(s => {
      const plan = data.feePlans.find(p => p.id === s.planId);
      const transactions = data.transactions.filter(t => t.studentId === s.id);
      const paid = transactions.reduce((sum, t) => sum + t.amount, 0);
      const balance = (plan?.totalAmount || 0) - paid;

      return {
        'Roll Number': s.rollNumber,
        'Name': s.name,
        'Guardian': s.guardianName,
        'Program': plan?.name || s.planId,
        'Branch': s.branch,
        'Semester': s.semester,
        'Session': s.session,
        'Phone': s.phone,
        'Email': s.email,
        'Admission Date': new Date(s.enrollmentDate).toLocaleDateString(),
        'Total Fee': plan?.totalAmount || 0,
        'Paid Amount': paid,
        'Balance Due': balance
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Enrolled Students");
    XLSX.writeFile(wb, `Student_Enrollment_Report_${new Date().toLocaleDateString()}.xlsx`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">Student Directory</h2>
          <p className="text-slate-500 font-medium font-sans">Manage admissions and search enrolled students</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
            accept=".xlsx, .xls, .csv" 
          />
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-white text-emerald-600 border-2 border-emerald-50 px-5 py-3.5 rounded-3xl font-bold shadow-sm hover:bg-emerald-50 transition-all active:scale-95 shrink-0"
          >
            <Upload size={20} />
            Bulk Upload
          </button>
          <button 
            onClick={handleDownload}
            className="flex items-center justify-center gap-2 bg-white text-blue-600 border-2 border-blue-50 px-5 py-3.5 rounded-3xl font-bold shadow-sm hover:bg-blue-50 transition-all active:scale-95 shrink-0"
          >
            <Download size={20} />
            Export Data
          </button>
          <button 
            onClick={openEnrollModal}
            className="flex items-center justify-center gap-2 bg-emerald-600 text-white px-7 py-3.5 rounded-3xl font-bold shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95 shrink-0"
          >
            <Plus size={20} />
            Enroll Student
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center gap-4">
        <Search className="text-slate-400" size={24} />
        <input 
          type="text" 
          placeholder="Search by name or roll number..." 
          className="flex-1 bg-transparent border-none outline-none text-slate-800 font-medium placeholder:text-slate-300"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredStudents.length === 0 ? (
           <div className="col-span-full py-20 bg-white rounded-[32px] border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300">
             <GraduationCap size={64} className="mb-4 opacity-20" />
             <p className="font-bold uppercase tracking-widest opacity-40">No Students Found</p>
           </div>
        ) : (
          filteredStudents.map((student) => {
            const plan = data.feePlans.find(p => p.id === student.planId);
            const transactions = data.transactions.filter(t => t.studentId === student.id);
            const paid = transactions.reduce((sum, t) => sum + t.amount, 0);
            const balance = (plan?.totalAmount || 0) - paid;

            return (
              <motion.div 
                layout
                key={student.id}
                className="bg-white rounded-[32px] p-6 border border-slate-200 shadow-sm relative group hover:border-emerald-200 transition-all"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center text-xl font-bold">
                    {(student.name || '?').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 truncate">{student.name || 'Unnamed Student'}</h3>
                    <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{student.rollNumber || 'NO-ROLL'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => openEditModal(student)}
                      className="text-slate-300 hover:text-emerald-600 transition-colors p-2 hover:bg-emerald-50 rounded-xl"
                    >
                      <MoreVertical size={20} />
                    </button>
                    <button 
                      onClick={async () => {
                        if (window.confirm(`Are you sure you want to delete ${student.name}? This will also delete all their payment records.`)) {
                          try {
                            // 1. Delete payments from Supabase first
                            const { error: pError } = await supabase
                              .from('payments')
                              .delete()
                              .eq('student_id', student.id);
                            
                            if (pError) throw new Error(`Failed to clear payments: ${pError.message}`);

                            // 2. Delete student record
                            const { error: sError } = await supabase
                              .from('students')
                              .delete()
                              .eq('id', student.id);
                            
                            if (sError) throw new Error(`Failed to remove student: ${sError.message}`);

                            // 3. Update local state
                            setData(prev => ({
                              ...prev,
                              students: prev.students.filter(s => s.id !== student.id),
                              transactions: prev.transactions.filter(t => t.studentId !== student.id)
                            }));
                            console.log('[Supabase] Student and payments purged successfully');
                          } catch (err: any) {
                            console.error('Purge error:', err);
                            alert('Cloud sync failed: ' + err.message + '\n\nPlease try again or use "System Audit" in Settings.');
                          }
                        }
                      }}
                      className="text-slate-300 hover:text-red-500 transition-colors p-2 hover:bg-red-50 rounded-xl"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                    <GraduationCap size={14} className="text-emerald-500" />
                    <span className="text-emerald-700">{plan?.name || student.planId}</span>
                    <span className="ml-auto text-slate-900">₹{(plan?.totalAmount || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                    <IndianRupee size={14} className={balance > 0 ? "text-rose-500" : "text-emerald-500"} />
                    <span className={balance > 0 ? "text-rose-600" : "text-emerald-600"}>Balance: ₹{balance.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                    <MapPin size={14} className="text-emerald-500" />
                    <span>{student.branch} • Sem {student.semester}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <button 
                    onClick={() => {
                      setViewingStudent(student);
                      setIsHistoryOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-700 transition-colors"
                  >
                    <FileText size={14} />
                    View Student Ledger
                  </button>
                  <span className="text-xs font-black text-emerald-600 italic underline decoration-emerald-200 underline-offset-4">{student.session}</span>
                </div>
              </motion.div>
            )
          })
        )}
      </div>

      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left no-print">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsImportModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[40px] shadow-2xl w-full max-w-3xl relative z-10 flex flex-col max-h-[90vh] overflow-hidden"
            >
              <div className="p-10 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                <div>
                   <h3 className="text-3xl font-black text-slate-800 tracking-tight uppercase">Bulk Student Import</h3>
                   <p className="text-slate-400 font-bold text-sm italic">Import data from Excel or CSV</p>
                </div>
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  className="p-3 bg-white text-slate-400 hover:text-red-500 rounded-2xl shadow-sm transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="p-10 space-y-10 overflow-y-auto custom-scrollbar flex-1">
                <div className="flex gap-4 p-1 bg-slate-100 rounded-2xl">
                  <button 
                    onClick={() => setImportMode('upload')}
                    className={`flex-1 py-3 px-4 rounded-xl text-xs font-black transition-all ${importMode === 'upload' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    File Upload
                  </button>
                  <button 
                    onClick={() => setImportMode('paste')}
                    className={`flex-1 py-3 px-4 rounded-xl text-xs font-black transition-all ${importMode === 'paste' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Copy-Paste
                  </button>
                </div>

                {importMode === 'upload' ? (
                  <div className="space-y-4">
                    <label className="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">Upload Data File</label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 rounded-[32px] p-12 flex flex-col items-center justify-center gap-4 hover:border-emerald-500 hover:bg-emerald-50 transition-all cursor-pointer group bg-slate-50/50"
                    >
                      <div className="w-24 h-24 bg-white group-hover:bg-emerald-100 text-slate-300 group-hover:text-emerald-600 rounded-[32px] flex items-center justify-center shadow-sm transition-all border border-slate-100">
                        <Upload size={40} />
                      </div>
                      <div className="text-center">
                        <p className="font-black text-slate-800 text-base">Choose Excel/CSV File</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">.xlsx, .xls, .csv supported</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest ml-1">Paste your data rows</label>
                    <textarea 
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-[32px] px-6 py-6 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 text-xs font-bold h-64 resize-none placeholder:text-slate-300 shadow-inner"
                      placeholder="Paste your Excel/Table rows here...&#10;Format: Name, Guardian, Program, Branch, Semester, Session, Roll Number, Phone, Email"
                      value={pasteData}
                      onChange={(e) => setPasteData(e.target.value)}
                    />
                  </div>
                )}

                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                   <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                     <FileText size={14} /> Expected Column Headers
                   </h4>
                   <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {['Name', 'Guardian', 'Program', 'Branch', 'Semester', 'Session', 'Roll Number', 'Phone', 'Email'].map(col => (
                        <div key={col} className="bg-white px-3 py-2 rounded-xl text-[10px] font-bold text-slate-600 border border-slate-200 flex items-center gap-2 shadow-sm">
                           <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                           {col}
                        </div>
                      ))}
                   </div>
                </div>
              </div>

              <div className="p-10 bg-slate-50 border-t border-slate-100 flex gap-4 shrink-0">
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  className="flex-1 bg-white border-2 border-slate-200 text-slate-400 font-bold py-5 rounded-3xl hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                >
                  Cancel
                </button>
                {importMode === 'paste' && (
                  <button 
                    onClick={handleCopyPasteImport}
                    disabled={!pasteData.trim()}
                    className="flex-1 bg-emerald-600 text-white font-bold py-5 rounded-3xl shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all uppercase tracking-widest text-xs disabled:opacity-50 disabled:shadow-none"
                  >
                    Import Pasted Data
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {isHistoryOpen && viewingStudent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsHistoryOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl relative z-10 overflow-hidden border border-white/20"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div>
                   <h3 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Student Ledger</h3>
                   <p className="text-slate-400 font-bold text-sm italic">{viewingStudent.name} • {viewingStudent.rollNumber}</p>
                </div>
                <button 
                  onClick={() => setIsHistoryOpen(false)}
                  className="p-2 bg-slate-50 text-slate-400 hover:text-red-500 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
                 <div className="space-y-4">
                    {data.transactions
                      .filter(t => t.studentId === viewingStudent.id)
                      .length === 0 ? (
                        <p className="text-center py-12 text-slate-300 font-black uppercase tracking-widest">No Payment History Found</p>
                      ) : (
                        data.transactions
                          .filter(t => t.studentId === viewingStudent.id)
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map(t => (
                            <div key={t.id} className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-emerald-200 transition-all">
                               <div className="space-y-1">
                                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{t.receiptNumber}</p>
                                  <p className="text-sm font-black text-slate-800 uppercase tracking-tight">{new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                  <p className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded inline-block">{t.mode}</p>
                               </div>
                               <div className="text-right">
                                  <p className="text-xl font-black text-slate-900 tracking-tighter italic">₹{t.amount.toFixed(2)}</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Received</p>
                               </div>
                            </div>
                          ))
                      )}
                 </div>
              </div>

              <div className="p-8 bg-slate-900 border-t border-slate-100 text-white relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl -mr-16 -mt-16"></div>
                 <div className="relative z-10 flex items-center justify-between">
                    <div>
                      <p className="font-black text-emerald-400 text-[9px] uppercase tracking-[0.3em] mb-1">Total Fee Collected</p>
                      <p className="text-3xl font-black italic">
                        ₹{data.transactions
                            .filter(t => t.studentId === viewingStudent.id || t.studentId === viewingStudent.rollNumber)
                            .reduce((sum, t) => sum + t.amount, 0)
                            .toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      {(() => {
                        const plan = data.feePlans.find(p => p.id === viewingStudent.planId);
                        const paid = data.transactions
                          .filter(t => t.studentId === viewingStudent.id || t.studentId === viewingStudent.rollNumber)
                          .reduce((sum, t) => sum + t.amount, 0);
                        const balance = (plan?.totalAmount || 0) - paid;
                        return (
                          <>
                            <p className="font-black text-slate-400 text-[9px] uppercase tracking-[0.3em] mb-1">Outstanding Balance</p>
                            <p className={`text-3xl font-black italic ${balance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              ₹{balance.toFixed(2)}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                 </div>
               </div>
            </motion.div>
          </div>
        )}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl relative z-10 overflow-hidden border border-white/20"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-2xl font-bold text-slate-800">
                  {editingStudent ? 'Edit Student Details' : 'Enroll New Student'}
                </h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 bg-slate-50 text-slate-400 hover:text-slate-600 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleEnroll} className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                   <div className="sm:col-span-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Full Name</label>
                    <input 
                      required
                      type="text" 
                      placeholder="e.g. Rahul Singh" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.name}
                      onChange={(e) => setNewStudent({...newStudent, name: e.target.value})}
                    />
                  </div>
                  
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Guardian Name</label>
                    <input 
                      type="text" 
                      placeholder="Father's Name" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.guardianName}
                      onChange={(e) => setNewStudent({...newStudent, guardianName: e.target.value})}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Program (Course)</label>
                    <select 
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.planId}
                      onChange={(e) => setNewStudent({...newStudent, planId: e.target.value})}
                    >
                      <option value="">Select Plan</option>
                      {data.feePlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Branch</label>
                    <select 
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.branch}
                      onChange={(e) => setNewStudent({...newStudent, branch: e.target.value})}
                    >
                      <option value="">Select Branch</option>
                      {data.masters.branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Current Semester</label>
                    <select 
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.semester}
                      onChange={(e) => setNewStudent({...newStudent, semester: e.target.value})}
                    >
                      <option value="">Select Sem</option>
                      {data.masters.semesters.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Academic Session</label>
                    <select 
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.session}
                      onChange={(e) => setNewStudent({...newStudent, session: e.target.value})}
                    >
                      {data.masters.sessions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Roll Number / ID</label>
                    <input 
                      required
                      type="text" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.rollNumber}
                      onChange={(e) => setNewStudent({...newStudent, rollNumber: e.target.value})}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Primary Phone</label>
                    <input 
                      type="tel" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.phone}
                      onChange={(e) => setNewStudent({...newStudent, phone: e.target.value})}
                    />
                  </div>

                   <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Email Address</label>
                    <input 
                      type="email" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                      value={newStudent.email}
                      onChange={(e) => setNewStudent({...newStudent, email: e.target.value})}
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-4">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 bg-slate-50 text-slate-500 font-bold py-4 rounded-3xl hover:bg-slate-100 transition-all capitalize"
                  >
                    Discard Changes
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-emerald-600 text-white font-bold py-4 rounded-3xl shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all uppercase tracking-widest text-sm"
                  >
                    {editingStudent ? 'Update Profile' : 'Grant Admission'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
