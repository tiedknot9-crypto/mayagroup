import React, { useState, useMemo, useRef } from 'react';
import { Search, Calendar, Download, FileSpreadsheet, FileIcon as FilePdf, CreditCard, Upload, Trash2 } from 'lucide-react';
import { AppData, Transaction, PaymentMode } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { supabaseService } from '../services/supabaseService';
import { supabase } from '../lib/supabase';

interface ReportsProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
}

export default function Reports({ data, setData }: ReportsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [reportType, setReportType] = useState<'collections' | 'dues'>('collections');

  const duesReport = useMemo(() => {
    return data.students.map(s => {
      const plan = data.feePlans.find(p => p.id === s.planId);
      const paid = data.transactions
        .filter(t => t.studentId === s.id || t.studentId === s.rollNumber)
        .reduce((sum, t) => sum + t.amount, 0);
      const balance = (plan?.totalAmount || 0) - paid;
      return { student: s, plan, paid, balance };
    }).filter(item => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return item.student.name.toLowerCase().includes(search) || 
             item.student.rollNumber.toLowerCase().includes(search);
    }).sort((a, b) => b.balance - a.balance);
  }, [data.students, data.feePlans, data.transactions, searchTerm]);

  const downloadDuesExcel = () => {
    const reportData = duesReport.map(item => ({
      'Roll Number': item.student.rollNumber,
      'Student Name': item.student.name,
      'Fee Plan': item.plan?.name || 'N/A',
      'Total Fee': item.plan?.totalAmount || 0,
      'Total Paid': item.paid,
      'Balance Due': item.balance,
      'Branch': item.student.branch,
      'Semester': item.student.semester
    }));

    const worksheet = XLSX.utils.json_to_sheet(reportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dues Report");
    XLSX.writeFile(workbook, `Dues_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredTransactions = useMemo(() => {
    const filtered = data.transactions.filter(t => {
      const student = data.students.find(s => s.id === t.studentId || s.rollNumber === t.studentId);
      const studentName = student?.name?.toLowerCase() || '';
      const roll = student?.rollNumber?.toLowerCase() || '';
      const txnId = t.transactionId?.toLowerCase() || '';
      const receipt = t.receiptNumber?.toLowerCase() || '';
      const search = searchTerm.toLowerCase();

      const matchesSearch = studentName.includes(search) || roll.includes(search) || txnId.includes(search) || receipt.includes(search);
      
      const tDate = new Date(t.date);
      const targetDateStr = !isNaN(tDate.getTime()) 
        ? tDate.toISOString().split('T')[0] 
        : (t.date || '').split('T')[0];

      const matchesFrom = fromDate ? targetDateStr >= fromDate : true;
      const matchesTo = toDate ? targetDateStr <= toDate : true;

      return matchesSearch && matchesFrom && matchesTo;
    });

    return [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.transactions, data.students, searchTerm, fromDate, toDate]);

  const downloadExcel = () => {
    const reportData = filteredTransactions.map(t => {
      const student = data.students.find(s => s.id === t.studentId || s.rollNumber === t.studentId);
      return {
        'Receipt No': t.receiptNumber,
        'Date': t.date && !isNaN(new Date(t.date).getTime()) ? new Date(t.date).toLocaleDateString() : 'N/A',
        'Student Name': student?.name || 'N/A',
        'Roll No': student?.rollNumber || 'N/A',
        'Branch': student?.branch || 'N/A',
        'Payment Mode': t.mode,
        'Transaction ID': t.transactionId || 'N/A',
        'Amount': t.amount,
        'Collected By': t.collectedBy || 'Admin',
        'Is Edited': t.isEdited ? 'Yes' : 'No',
        'Edited By': t.editedBy || 'N/A'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(reportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Fee Report");
    XLSX.writeFile(workbook, `Fee_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const downloadPDF = () => {
    const doc = new jsPDF();
    doc.text(`${data.institution.name} - Fee Collection Report`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 22);

    const tableData = filteredTransactions.map(t => {
      const student = data.students.find(s => s.id === t.studentId || s.rollNumber === t.studentId);
      return [
        t.receiptNumber,
        (t.date && !isNaN(new Date(t.date).getTime())) ? new Date(t.date).toLocaleDateString() : 'N/A',
        student?.name || 'N/A',
        t.mode,
        t.transactionId || 'N/A',
        `Rs. ${t.amount.toLocaleString()}`
      ];
    });

    autoTable(doc, {
      head: [['Receipt', 'Date', 'Student', 'Mode', 'Txn ID', 'Amount']],
      body: tableData,
      startY: 28,
      theme: 'grid',
      headStyles: { fillColor: [5, 150, 105], textColor: 255 },
    });

    doc.save(`Fee_Report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleImportTransactions = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const fileData = evt.target?.result;
      const wb = XLSX.read(fileData, { type: 'array', cellDates: true, cellNF: false, cellText: false });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];
      
      if (rows.length === 0) return;

      // PRE-PROCESS STUDENTS FOR FAST LOOKUP (Fixes 16s INP issue)
      const normalize = (val: any) => String(val || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const studentMap = new Map<string, any>();
      data.students.forEach(s => {
        if (s.name) studentMap.set(normalize(s.name), s);
        if (s.rollNumber) studentMap.set(normalize(s.rollNumber), s);
        if (s.id) studentMap.set(normalize(s.id), s);
      });

      // Detect header row or use default mapping
      const studentKeywords = ['student', 'name', 'roll', 'id', 'candidate', 'enroll'];
      const txnKeywords = ['transaction', 'utr', 'ref', 'reference', 'txn', 'payment id'];
      const amountKeywords = ['amount', 'fee', 'paid', 'total', 'collection', 'val', 'price'];
      const dateKeywords = ['date', 'time', 'day', 'at'];

      let startIndex = 0;
      let colMap: Record<string, number> = { student: -1, txnId: -1, amount: -1, date: -1 };

      // Try to find headers in the first 3 rows
      for (let r = 0; r < Math.min(3, rows.length); r++) {
        const row = rows[r].map(c => String(c || '').toLowerCase());
        const matches = row.filter(c => 
          studentKeywords.some(kw => c.includes(kw)) || 
          txnKeywords.some(kw => c.includes(kw)) || 
          amountKeywords.some(kw => c.includes(kw))
        );

        if (matches.length >= 2) {
          // Found headers!
          rows[r].forEach((cell, idx) => {
            const c = String(cell || '').toLowerCase();
            if (studentKeywords.some(kw => c.includes(kw)) && colMap.student === -1) colMap.student = idx;
            if (txnKeywords.some(kw => c.includes(kw)) && colMap.txnId === -1) colMap.txnId = idx;
            if (amountKeywords.some(kw => c.includes(kw)) && colMap.amount === -1) colMap.amount = idx;
            if (dateKeywords.some(kw => c.includes(kw)) && colMap.date === -1) colMap.date = idx;
          });
          startIndex = r + 1;
          break;
        }
      }

      // If no headers found, use default indices (Common pattern: Name, UTR, Amount, Date)
      if (colMap.student === -1) {
        colMap = { student: 0, txnId: 1, amount: 2, date: 3 };
        startIndex = 0;
      }

      const newTransactions: Transaction[] = [];
      const skipped: string[] = [];

      // Use a loop that yields to UI if needed, but the Map lookup should be fast enough now
      for (let i = startIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const studentRefRaw = colMap.student !== -1 ? row[colMap.student] : null;
        const txnIdRaw = colMap.txnId !== -1 ? row[colMap.txnId] : null;
        const amountRaw = colMap.amount !== -1 ? row[colMap.amount] : 0;
        const dateInputRaw = colMap.date !== -1 ? row[colMap.date] : null;

        const studentRef = normalize(studentRefRaw);
        
        // SKIP HEADER ROWS OR EMPTY NAMES
        if (!studentRef || 
            studentRef === 'student' || 
            studentRef === 'name' || 
            studentRef === 'payer' ||
            studentRef === 'student transaction amount date' ||
            studentRef.includes('transaction id')) {
          continue;
        }

        const txnId = String(txnIdRaw || '').trim();
        const cleanTxnId = txnId.toString().trim();
        const amount = typeof amountRaw === 'number' ? amountRaw : parseFloat(String(amountRaw || '0').replace(/[^0-9.]/g, '')) || 0;

        // Date parsing (moved up for scoping)
        let parsedDate = new Date();
        try {
          if (dateInputRaw instanceof Date && !isNaN(dateInputRaw.getTime())) {
            parsedDate = dateInputRaw;
          } else if (typeof dateInputRaw === 'number' && dateInputRaw > 10000) {
            parsedDate = new Date((dateInputRaw - 25569) * 86400 * 1000);
          } else if (dateInputRaw) {
              const dateStr = String(dateInputRaw).trim();
              const dParts = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
              if (dParts) {
                const day = parseInt(dParts[1]);
                const month = parseInt(dParts[2]) - 1;
                let year = parseInt(dParts[3]);
                if (year < 100) year += 2000;
                const dObj = new Date(year, month, day);
                if (!isNaN(dObj.getTime())) parsedDate = dObj;
              } else {
                const dObj = new Date(dateStr);
                if (!isNaN(dObj.getTime())) parsedDate = dObj;
              }
          }
        } catch { parsedDate = new Date(); }

        const safeIsoDate = !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString();

        if (!studentRef) {
          if (i === startIndex && i === 0) continue; // Might be a header row we missed
          skipped.push(`Row ${i + 1}: Missing student identifier`);
          continue;
        }

        const student = studentMap.get(studentRef);

        if (!student) {
          // AUTO-CREATE STUDENT LOGIC (Unify with Payments.tsx)
          const tempId = crypto.randomUUID();
          const validPlanId = data.feePlans.length > 0 
            ? data.feePlans[0].id 
            : '00000000-0000-0000-0000-000000000000';

          const autoStudent = {
            id: tempId,
            name: String(studentRefRaw || 'Unknown').trim(),
            guardianName: '',
            planId: validPlanId,
            branch: data.masters.branches[0] || 'General',
            semester: data.masters.semesters[0] || 'I',
            session: data.masters.sessions[0] || '2024-25',
            rollNumber: `AUTO-${Date.now().toString().slice(-4)}-${i}`,
            phone: '',
            email: '',
            enrollmentDate: new Date().toISOString()
          };

          // Temporarily add to map and data for this session
          studentMap.set(studentRef, autoStudent);
          
          // We'll handle bulk saving below
          setData(prev => ({
            ...prev,
            students: [...prev.students, autoStudent]
          }));
          
          // Actually save it immediately or in bulk before transactions
          await supabaseService.bulkSaveStudents([autoStudent]);
          
          // Now set student to the newly created one
          const updatedStudent = autoStudent;

          newTransactions.push({
            id: crypto.randomUUID(),
            studentId: updatedStudent.id,
            amount: amount,
            date: safeIsoDate,
            time: '00:00:00',
            mode: cleanTxnId ? 'UPI' : 'Cash',
            academicTerm: 'Imported',
            receiptNumber: `IMP-${Date.now().toString().slice(-6)}-${i}`,
            transactionId: cleanTxnId || undefined,
            remarks: 'Imported historical record (Auto-created student)',
            feeHeadIds: [],
            collectedBy: 'Import Tool'
          });
          continue;
        }

        if (cleanTxnId && data.transactions.some(t => t.transactionId === cleanTxnId)) {
          skipped.push(`Row ${i + 1}: Transaction "${cleanTxnId}" already exists`);
          continue;
        }

        newTransactions.push({
          id: crypto.randomUUID(),
          studentId: student.id,
          amount: amount,
          date: safeIsoDate,
          time: '00:00:00',
          mode: cleanTxnId ? 'UPI' : 'Cash',
          academicTerm: 'Imported',
          receiptNumber: `IMP-${Date.now().toString().slice(-6)}-${i}`,
          transactionId: cleanTxnId || undefined,
          remarks: 'Imported historical record',
          feeHeadIds: [],
          collectedBy: 'Import Tool'
        });
      }

      if (newTransactions.length > 0) {
        // Sync to Supabase in bulk
        supabaseService.bulkSaveTransactions(newTransactions)
          .then(() => console.log('Bulk transaction sync successful'))
          .catch(err => console.error('Bulk transaction sync failed:', err));

        setData(prev => ({
          ...prev,
          transactions: [...prev.transactions, ...newTransactions]
        }));
        
        let msg = `Successfully imported ${newTransactions.length} transactions.`;
        if (skipped.length > 0) {
          msg += `\n\nSkipped ${skipped.length} rows (Errors: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''})`;
        }
        alert(msg);
      } else if (skipped.length > 0) {
        alert('Import failed. Errors:\n' + skipped.slice(0, 10).join('\n'));
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Financial Intelligence</h2>
          <p className="text-slate-500 font-medium font-sans">Global collections tracking and student ledger auditing</p>
        </div>
        <div className="bg-slate-100 p-1.5 rounded-2xl flex gap-1">
           <button 
            onClick={() => setReportType('collections')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${reportType === 'collections' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200'}`}
           >
            Collections
           </button>
           <button 
            onClick={() => setReportType('dues')}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${reportType === 'dues' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-200'}`}
           >
            Ledger / Dues
           </button>
        </div>
      </div>

      <div className="bg-white rounded-[40px] p-10 border border-slate-200 shadow-sm space-y-8 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50/20 rounded-full blur-3xl -mr-32 -mt-32"></div>
        
        <div className="flex flex-col lg:flex-row gap-8 relative z-10">
          <div className="flex-[2] space-y-3">
             <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Search User / Ref / ID</label>
             <div className="bg-slate-50 border border-slate-100 rounded-full flex items-center px-6 gap-4 h-16 group focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 transition-all">
                <Search className="text-slate-400" size={20} />
                <input 
                  type="text" 
                  placeholder={reportType === 'collections' ? "Enter bank reference or student name..." : "Search student for ledger..."} 
                  className="flex-1 bg-transparent border-none outline-none font-medium text-slate-700"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
             </div>
          </div>

          {reportType === 'collections' && (
            <div className="flex-1 min-w-[300px] flex gap-4">
               <div className="flex-1 space-y-3 font-sans">
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">From Date</label>
                 <div className="bg-slate-50 border border-slate-100 rounded-2xl flex items-center px-5 gap-3 h-16">
                    <Calendar className="text-slate-400 shrink-0" size={18} />
                    <input 
                      type="date" 
                      className="flex-1 bg-transparent border-none outline-none text-xs font-bold text-slate-600"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                 </div>
               </div>
               <div className="flex-1 space-y-3">
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">To Date</label>
                 <div className="bg-slate-50 border border-slate-100 rounded-2xl flex items-center px-5 gap-3 h-16">
                    <Calendar className="text-slate-400 shrink-0" size={18} />
                    <input 
                      type="date" 
                      className="flex-1 bg-transparent border-none outline-none text-xs font-bold text-slate-600"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                 </div>
               </div>
            </div>
          )}

          <div className="flex items-end gap-4 shrink-0">
             <div className="bg-emerald-600 rounded-[28px] h-20 px-8 flex flex-col justify-center items-center shadow-xl shadow-emerald-200">
                <span className="text-[10px] font-black text-emerald-100 uppercase tracking-[0.2em] mb-1">
                  {reportType === 'collections' ? 'Total Collection' : 'Total Outstanding'}
                </span>
                <span className="text-2xl font-black text-white leading-none">
                  ₹{reportType === 'collections' 
                    ? filteredTransactions.reduce((sum, t) => sum + t.amount, 0).toLocaleString()
                    : duesReport.reduce((sum, item) => sum + Math.max(0, item.balance), 0).toLocaleString()
                  }
                </span>
             </div>
             {reportType === 'collections' && (
               <div className="bg-white border-2 border-slate-100 rounded-[28px] h-20 px-8 flex flex-col justify-center items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Total Records</span>
                  <span className="text-2xl font-black text-slate-800 leading-none">{filteredTransactions.length}</span>
               </div>
             )}
             <div className="flex flex-col gap-2">
                {reportType === 'collections' ? (
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-emerald-600 rounded-xl px-4 py-2 flex items-center justify-center gap-2 text-[10px] font-black text-white uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                  >
                    <Upload size={16} /> Import Excel
                  </button>
                ) : (
                  <button 
                    onClick={downloadDuesExcel}
                    className="bg-rose-600 rounded-xl px-4 py-2 flex items-center justify-center gap-2 text-[10px] font-black text-white uppercase tracking-widest hover:bg-rose-700 transition-all shadow-lg shadow-rose-200"
                  >
                    <Download size={16} /> Export Dues
                  </button>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImportTransactions} 
                  className="hidden" 
                  accept=".xlsx, .xls, .csv" 
                />
                <div className="flex gap-2">
                   <button 
                     onClick={downloadExcel}
                     className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2 flex-1 flex items-center justify-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-50 transition-all hover:border-emerald-200 hover:text-emerald-600"
                   >
                     <FileSpreadsheet size={16} /> Excel
                   </button>
                   {reportType === 'collections' && (
                     <button 
                       onClick={downloadPDF}
                        className="bg-white border-2 border-slate-100 rounded-xl px-4 py-2 flex-1 flex items-center justify-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-50 transition-all hover:border-red-200 hover:text-red-600"
                     >
                       <FilePdf size={16} /> PDF
                     </button>
                   )}
                </div>
             </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-8 overflow-x-auto custom-scrollbar">
           {reportType === 'collections' ? (
             <table className="w-full text-left">
                <thead>
                  <tr>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Receipt / Date</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Student Payer</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Reference / Collected By</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                   {filteredTransactions.length === 0 ? (
                      <tr>
                         <td colSpan={5} className="py-20 text-center">
                            <div className="flex flex-col items-center justify-center text-slate-200">
                               <Search size={64} className="mb-4" />
                               <p className="font-black uppercase tracking-[0.3em] text-slate-300">No matching records</p>
                            </div>
                         </td>
                      </tr>
                   ) : (
                      filteredTransactions.map(t => {
                        const student = data.students.find(s => s.id === t.studentId || s.rollNumber === t.studentId);
                        return (
                           <tr key={t.id} className="group hover:bg-slate-50/50 transition-all">
                              <td className="py-6 border-b border-slate-50">
                                 <p className="text-sm font-black text-slate-800">{t.receiptNumber}</p>
                                 <p className="text-xs font-bold text-slate-400">
                                   {t.date && !isNaN(new Date(t.date).getTime()) 
                                     ? new Date(t.date).toLocaleDateString() 
                                     : 'No Date'}
                                 </p>
                              </td>
                              <td className="py-6 border-b border-slate-50 text-center">
                                 <p className="text-sm font-bold text-slate-700">{student?.name || 'N/A'}</p>
                                 <p className="text-[10px] font-black text-slate-400 uppercase">{student?.rollNumber || 'N/A'}</p>
                              </td>
                               <td className="py-6 border-b border-slate-50 text-center">
                                 <div className="flex flex-col items-center gap-1">
                                    <span className="font-mono text-xs uppercase text-slate-500">{t.transactionId || '<CASH>'}</span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">By: {t.collectedBy || 'Admin'}</span>
                                      {t.isEdited && (
                                        <span className="bg-rose-50 text-rose-600 text-[8px] font-black px-1 py-0.5 rounded border border-rose-100 uppercase animate-pulse">Edited</span>
                                      )}
                                    </div>
                                 </div>
                              </td>
                              <td className="py-6 border-b border-slate-50 text-right">
                                 <p className="text-base font-black text-emerald-600">₹{t.amount.toLocaleString()}</p>
                              </td>
                              <td className="py-6 border-b border-slate-50 text-right">
                                 <button 
                                   onClick={async () => {
                                     if (window.confirm('Are you sure you want to delete this payment record?')) {
                                       setData(prev => ({
                                         ...prev,
                                         transactions: prev.transactions.filter(item => item.id !== t.id)
                                       }));
                                       // Sync deletion
                                       await supabase.from('payments').delete().eq('receipt_number', t.receiptNumber);
                                     }
                                   }}
                                   className="text-slate-300 hover:text-red-500 transition-colors p-2"
                                 >
                                   <Trash2 size={16} />
                                 </button>
                              </td>
                           </tr>
                        );
                      })
                   )}
                </tbody>
             </table>
           ) : (
             <table className="w-full text-left">
                <thead>
                  <tr>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Student / ID</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Plan / Program</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Total Fee</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Paid Amount</th>
                     <th className="pb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody>
                   {duesReport.length === 0 ? (
                      <tr>
                         <td colSpan={5} className="py-20 text-center text-slate-300">No students matching search</td>
                      </tr>
                   ) : (
                      duesReport.map(item => (
                         <tr key={item.student.id} className="group hover:bg-slate-50/50 transition-all">
                            <td className="py-6 border-b border-slate-50">
                               <p className="text-sm font-black text-slate-800 uppercase tracking-tight">{item.student.name}</p>
                               <p className="text-xs font-bold text-slate-400">{item.student.rollNumber}</p>
                            </td>
                            <td className="py-6 border-b border-slate-50">
                               <p className="text-xs font-black text-slate-600 uppercase tracking-tight">{item.plan?.name || 'No Plan Assigned'}</p>
                            </td>
                            <td className="py-6 border-b border-slate-50 text-center font-bold text-slate-700">
                               ₹{item.plan?.totalAmount.toLocaleString() || 0}
                            </td>
                            <td className="py-6 border-b border-slate-50 text-center font-bold text-emerald-600">
                               ₹{item.paid.toLocaleString()}
                            </td>
                            <td className="py-6 border-b border-slate-50 text-right">
                               <span className={`text-base font-black italic ${item.balance > 0 ? 'text-rose-600' : 'text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full'}`}>
                                 {item.balance > 0 ? `₹${item.balance.toLocaleString()}` : 'FULL PAID'}
                               </span>
                            </td>
                         </tr>
                      ))
                   )}
                </tbody>
             </table>
           )}
        </div>
      </div>
    </div>
  );
}
