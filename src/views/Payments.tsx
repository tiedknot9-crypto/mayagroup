import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CreditCard, Search, X, CheckCircle2, AlertTriangle, IndianRupee, Printer, Send, MessageSquare, AlertCircle, Upload, FileText } from 'lucide-react';
import { AppData, Transaction, PaymentMode, Staff, Student } from '../types';
import * as XLSX from 'xlsx';
import { supabaseService } from '../services/supabaseService';
import { supabase } from '../lib/supabase';

interface PaymentsProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  currentStaff: Staff | null;
}

export default function Payments({ data, setData, currentStaff }: PaymentsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [importMode, setImportMode] = useState<'upload' | 'paste'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [newTransaction, setNewTransaction] = useState<Partial<Transaction>>({
    date: new Date().toISOString().split('T')[0],
    studentId: '',
    transactionId: '',
    amount: 0,
    mode: 'UPI',
    academicTerm: '',
    remarks: '',
  });

  const resetForm = () => {
    setNewTransaction({
      date: new Date().toISOString().split('T')[0],
      studentId: '',
      transactionId: '',
      amount: 0,
      mode: 'UPI',
      academicTerm: '',
      remarks: '',
    });
    setEditingTxnId(null);
  };

  const handlePrint = () => {
    window.print();
  };

  const paymentModes: PaymentMode[] = ['UPI', 'Cash', 'Card', 'Bank Transfer'];

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newTransaction.mode !== 'Cash' && newTransaction.transactionId) {
      const isDuplicate = data.transactions.some(t => 
        t.id !== editingTxnId && t.mode !== 'Cash' && t.transactionId === newTransaction.transactionId
      );
      
      if (isDuplicate) {
        alert('ALERT: Duplication transaction ID detected! This transaction ID has already been recorded for a UPI/Card/Bank payment.');
        return;
      }
    }

    if (newTransaction.studentId && newTransaction.amount) {
      const student = data.students.find(s => s.id === newTransaction.studentId);
      const plan = data.feePlans.find(p => p.id === student?.planId);
      
      const existingTxn = editingTxnId ? data.transactions.find(t => t.id === editingTxnId) : null;

      const transaction: Transaction = {
        id: editingTxnId || crypto.randomUUID(),
        studentId: newTransaction.studentId!,
        amount: Number(newTransaction.amount),
        date: newTransaction.date ? new Date(newTransaction.date).toISOString() : (existingTxn?.date || new Date().toISOString()),
        time: existingTxn?.time || new Date().toLocaleTimeString('en-US', { hour12: false }),
        mode: newTransaction.mode as PaymentMode,
        transactionId: newTransaction.mode === 'Cash' ? undefined : newTransaction.transactionId,
        academicTerm: newTransaction.academicTerm || existingTxn?.academicTerm || `Sem ${student?.semester || 'I'}`,
        receiptNumber: existingTxn?.receiptNumber || `RC-${Date.now().toString().slice(-6)}`,
        remarks: newTransaction.remarks || '',
        feeHeadIds: plan?.components.map(c => c.id) || existingTxn?.feeHeadIds || [],
        collectedBy: existingTxn?.collectedBy || currentStaff?.name || 'System',
        isEdited: !!editingTxnId,
        editedBy: editingTxnId ? (currentStaff?.name || 'Staff') : undefined,
        editReason: editingTxnId ? 'Manual adjustment by staff' : undefined,
      };

      setData(prev => ({
        ...prev,
        transactions: editingTxnId 
          ? prev.transactions.map(t => t.id === editingTxnId ? transaction : t)
          : [...prev.transactions, transaction]
      }));

      // Sync to Supabase
      await supabaseService.saveTransaction(transaction);
      
      setIsModalOpen(false);
      if (!editingTxnId) setSelectedTxn(transaction); 
      resetForm();
    }
  };

  const handleBulkImportPayments = async (txns: Transaction[], newStudents: Student[] = []) => {
    if (txns.length > 0 || newStudents.length > 0) {
      try {
        if (newStudents.length > 0) {
          await supabaseService.bulkSaveStudents(newStudents);
          console.log('Bulk student creation successful');
        }
        
        await supabaseService.bulkSaveTransactions(txns);
        console.log('Bulk payment sync successful');

        setData(prev => ({
          ...prev,
          students: [...prev.students, ...newStudents],
          transactions: [...prev.transactions, ...txns]
        }));
        
        alert(`Successfully imported ${txns.length} payment records. ${newStudents.length > 0 ? `Created ${newStudents.length} new student records.` : ''}`);
        setIsImportModalOpen(false);
        setPasteData('');
      } catch (err) {
        console.error('Bulk import failed:', err);
        alert('Failed to import records. Please check the console for details.');
      }
    }
  };

  const parsePaymentData = (items: any[][]): { transactions: Transaction[], newStudents: Student[] } => {
    if (items.length === 0) return { transactions: [], newStudents: [] };

    let headerRowIndex = -1;
    let headers: string[] = [];

    // Try to find the header row (some row that contains "student", "roll", or "amount")
    for (let i = 0; i < Math.min(items.length, 5); i++) {
      const rowStr = items[i].join(' ').toLowerCase();
      if (rowStr.includes('student') || rowStr.includes('roll') || rowStr.includes('amount') || rowStr.includes('name')) {
        headerRowIndex = i;
        headers = items[i].map(h => String(h).toLowerCase().trim());
        break;
      }
    }

    let dataRows = items;
    let rollIdx = 0;
    let amountIdx = 1;
    let dateIdx = 2;
    let txnIdx = 3;
    let modeIdx = -1;
    let termIdx = -1;

    if (headerRowIndex !== -1) {
      rollIdx = headers.findIndex(h => h.includes('roll') || h.includes('student') || h.includes('name') || h.includes('payer'));
      amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('fee') || h.includes('paid'));
      dateIdx = headers.findIndex(h => h.includes('date') || h.includes('when'));
      modeIdx = headers.findIndex(h => h.includes('mode') || h.includes('type') || h.includes('method'));
      txnIdx = headers.findIndex(h => h.includes('id') || h.includes('transaction') || h.includes('utr') || h.includes('ref'));
      termIdx = headers.findIndex(h => h.includes('term') || h.includes('sem') || h.includes('session'));
      dataRows = items.slice(headerRowIndex + 1);
    } else {
      // Smart Guessing for Space-Delimited Data or Headerless Data
      // If we have many parts (like split by single space), we need to identify column roles
      const firstRow = items[0];
      
      if (firstRow.length > 4) {
        // Try to find the amount (a number, usually the second to last or third to last)
        // and date (contains / or -)
        amountIdx = -1;
        for (let i = firstRow.length - 1; i >= 0; i--) {
          const v = firstRow[i];
          if (!isNaN(parseFloat(String(v).replace(/[^0-9.]/g, ''))) && parseFloat(String(v).replace(/[^0-9.]/g, '')) > 0) {
            amountIdx = i;
            break;
          }
        }
        dateIdx = firstRow.findIndex(v => String(v).includes('/') || String(v).includes('-'));
        
        // If amount and date are found, everything before them could be the name
        // But for now, we'll try to find a "roll number" like index
        rollIdx = 0; // Default to first
        txnIdx = firstRow.findIndex((v, i) => i !== amountIdx && i !== dateIdx && i !== rollIdx && String(v).length > 5);
      } else {
        // Fallback: guess by index if no headers found
        // Assuming: Student, Transaction, Amount, Date
        rollIdx = 0;
        txnIdx = 1;
        amountIdx = 2;
        dateIdx = 3;
      }
    }

    if (rollIdx === -1 || amountIdx === -1 || rollIdx === amountIdx) {
      // Final attempt: if we have 4 columns, assume Name, Txn, Amount, Date
      if (items[0].length >= 4) {
        rollIdx = 0; txnIdx = 1; amountIdx = 2; dateIdx = 3;
      } else if (rollIdx === amountIdx && rollIdx !== -1) {
        // This usually happens when the header detection fails and maps everything to 0
        rollIdx = 0; txnIdx = 1; amountIdx = 2; dateIdx = 3;
      } else {
        alert('Could not identify "Student/Name" and "Amount" columns. Please ensure your data has clear headers or at least 3 columns.');
        return { transactions: [], newStudents: [] };
      }
    }

    const errors: string[] = [];
    const importedTxns: Transaction[] = [];
    const newStudents: Student[] = [];

    dataRows.forEach((row, idx) => {
      if (!row || row.length === 0) return;
      
      // If row was split by single spaces, Row[rollIdx] might only be the FIRST word of a name.
      // We should try to reconstruct the name if rollIdx=0 and amountIdx > 1
      let rawRollOrName = '';
      if (headerRowIndex === -1 && rollIdx === 0 && amountIdx > 1) {
         // Join all parts before the amount that don't look like dates/numbers
         rawRollOrName = row.slice(0, amountIdx).join(' ').trim();
      } else {
         rawRollOrName = String(row[rollIdx] || '').trim();
      }

      // Skip header rows or empty names
      const lowerName = rawRollOrName.toLowerCase();
      if (!rawRollOrName || 
          lowerName === 'student' || 
          lowerName === 'name' || 
          lowerName === 'payer' ||
          lowerName === 'student transaction amount date' ||
          lowerName.includes('transaction id') ||
          lowerName.includes('amount') ||
          lowerName.includes('date') ||
          lowerName.includes('total')) return;

      const amountValue = row[amountIdx];
      const amount = typeof amountValue === 'number' ? amountValue : parseFloat(String(amountValue).replace(/[^0-9.]/g, '')) || 0;
      
      if (amount <= 0 && !rawRollOrName) return;

      // Robust Student Matching
      const normalizedQuery = rawRollOrName.toLowerCase().trim();
      let student = [...data.students, ...newStudents].find(s => 
        s.rollNumber.toLowerCase().trim() === normalizedQuery || 
        s.name.toLowerCase().trim() === normalizedQuery ||
        s.id.toLowerCase().trim() === normalizedQuery
      );

      // Partial matching for names if exact match fails
      if (!student) {
        student = [...data.students, ...newStudents].find(s => 
          s.name.toLowerCase().includes(normalizedQuery) ||
          normalizedQuery.includes(s.name.toLowerCase())
        );
      }

      // If student still not found, create one!
      if (!student) {
        const tempId = crypto.randomUUID();
        
        // Find a valid plan ID (fallback to first available or a placeholder UUID)
        const validPlanId = data.feePlans.length > 0 
          ? data.feePlans[0].id 
          : '00000000-0000-0000-0000-000000000000'; // Default valid UUID format

        const autoStudent: Student = {
          id: tempId,
          name: rawRollOrName,
          guardianName: '',
          planId: validPlanId,
          branch: data.masters.branches[0] || 'General',
          semester: data.masters.semesters[0] || 'I',
          session: data.masters.sessions[0] || '2024-25',
          rollNumber: `AUTO-${Date.now().toString().slice(-4)}-${idx}`,
          phone: '',
          email: '',
          enrollmentDate: new Date().toISOString()
        };
        newStudents.push(autoStudent);
        student = autoStudent;
      }

      // Handle Date Robustly
      let processedDate: string;
      try {
        const d = row[dateIdx];
        let dateObj: Date | null = null;
        
        if (typeof d === 'number') {
          // Handle Excel serial date
          dateObj = new Date((d - 25569) * 86400 * 1000);
        } else if (d) {
          const dateStr = String(d).trim();
          // Try DD-MM-YYYY or DD/MM/YYYY
          const dParts = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
          if (dParts) {
            const day = parseInt(dParts[1]);
            const month = parseInt(dParts[2]) - 1;
            let year = parseInt(dParts[3]);
            if (year < 100) year += 2000;
            dateObj = new Date(year, month, day);
          } else {
            dateObj = new Date(dateStr);
          }
        }

        if (dateObj && !isNaN(dateObj.getTime())) {
          processedDate = dateObj.toISOString();
        } else {
          processedDate = new Date().toISOString();
        }
      } catch (err) {
        console.warn('Date parsing failed for row', idx, err);
        processedDate = new Date().toISOString();
      }

      // Ensure transaction ID is clean
      const rawTxnId = txnIdx !== -1 && row[txnIdx] ? String(row[txnIdx]).trim() : undefined;
      const cleanTxnId = rawTxnId && rawTxnId.length > 2 ? rawTxnId : undefined;

      importedTxns.push({
        id: crypto.randomUUID(),
        studentId: student.id,
        amount,
        date: processedDate,
        time: '12:00:00',
        mode: (modeIdx !== -1 && row[modeIdx] ? String(row[modeIdx]).toUpperCase() : (cleanTxnId ? 'UPI' : 'Cash')) as PaymentMode,
        transactionId: cleanTxnId,
        academicTerm: termIdx !== -1 && row[termIdx] ? String(row[termIdx]) : `Sem ${student.semester}`,
        receiptNumber: `IMP-${Date.now().toString().slice(-4)}-${idx}-${Math.random().toString(36).slice(-2)}`,
        remarks: 'Bulk Import',
        feeHeadIds: [],
        collectedBy: currentStaff?.name || 'Bulk Import',
      });
    });

    if (errors.length > 0) {
      alert(`Import found issues with ${errors.length} rows:\n\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more.` : ''}\n\nValid records (${importedTxns.length}) will proceed.`);
    }

    return { transactions: importedTxns, newStudents };
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
        
        const { transactions, newStudents } = parsePaymentData(rows);
        if (transactions.length > 0 || newStudents.length > 0) {
          handleBulkImportPayments(transactions, newStudents);
        }
      } catch (err) {
        console.error(err);
        alert('Failed to parse file. Please ensure it is a valid Excel or CSV file.');
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopyPasteImport = () => {
    if (!pasteData.trim()) return;
    
    const lines = pasteData.trim().split('\n');
    const items = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.includes('\t')) return trimmed.split('\t');
      if (trimmed.includes(',')) return trimmed.split(',').map(s => s.trim());
      // Multi-space detection
      if (trimmed.includes('  ')) return trimmed.split(/\s{2,}/).map(s => s.trim());
      
      // Smart Space Split: if it looks like there are multiple space-separated parts 
      // containing a number or date at the end, it's likely a table row
      const spaceParts = trimmed.split(/\s+/);
      if (spaceParts.length >= 3) {
        // Find indices that are likely Amount or Date (at the end)
        // Usually: [Name..., Roll/ID, Amount, Date]
        // We'll return these as is and let the column guesser handle it
        return spaceParts;
      }

      return [trimmed];
    });

    const { transactions, newStudents } = parsePaymentData(items);
    if (transactions.length > 0 || newStudents.length > 0) {
      handleBulkImportPayments(transactions, newStudents);
    }
  };

  return (
    <div className="space-y-8">
      <style>
        {`
          @media print {
            body * { visibility: hidden; }
            #printable-receipt, #printable-receipt * { visibility: visible; }
            #printable-receipt { 
              position: absolute; 
              left: 0; 
              top: 0; 
              width: 100%;
              padding: 0;
              margin: 0;
            }
            .no-print { display: none !important; }
          }
        `}
      </style>

      <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm relative overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-6 no-print">
        <div className="flex items-center gap-6 relative z-10">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
            <IndianRupee size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-slate-800">Fee Collection</h2>
            <p className="text-slate-500 font-medium font-sans">Record and manage payments from students</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3 z-10">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
            accept=".xlsx, .xls, .csv" 
          />
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-white text-emerald-600 border-2 border-emerald-50 px-6 py-4 rounded-3xl font-bold shadow-sm hover:bg-emerald-50 transition-all active:scale-95 shrink-0"
          >
            <Upload size={20} />
            Bulk Import
          </button>
          <button 
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="bg-emerald-600 text-white px-8 py-4 rounded-3xl font-bold shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95 shrink-0"
          >
            Collect New Fee
          </button>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50/30 rounded-full blur-3xl -mr-32 -mt-32"></div>
      </div>

      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden no-print">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-bold text-slate-800">Recent Collections</h3>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{data.transactions.length} Total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Receipt Date</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Student</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Transaction Details</th>
                <th className="px-8 py-5 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                <th className="px-8 py-5 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center text-slate-300">
                    <div className="flex flex-col items-center justify-center">
                       <CreditCard size={48} className="mb-4 opacity-20" />
                       <p className="font-bold uppercase tracking-widest opacity-40">No records found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                [...data.transactions]
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .slice(0, 10)
                  .map((t) => {
                  const student = data.students.find(s => s.id === t.studentId || s.rollNumber === t.studentId);
                  return (
                    <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors group">
                      <td className="px-8 py-5">
                        <p className="text-sm font-bold text-slate-800">
                          {t.date && !isNaN(new Date(t.date).getTime()) 
                            ? new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) 
                            : 'N/A'}
                        </p>
                        <p className="text-[9px] text-slate-400 font-mono">{t.receiptNumber}</p>
                      </td>
                      <td className="px-8 py-5">
                        <p className="text-sm font-bold text-emerald-800 truncate max-w-[150px]">
                          {student?.name || 'Unknown Student'}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                           Roll: {student?.rollNumber || 'N/A'}
                        </p>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          {t.transactionId ? (
                             <p className="text-[11px] font-mono font-black text-slate-700 bg-slate-100 px-2 py-1 rounded-md inline-block uppercase tracking-tighter">{t.transactionId}</p>
                          ) : (
                             <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded uppercase">Cash</span>
                          )}
                          {t.isEdited && (
                            <span className="bg-rose-50 text-rose-600 text-[8px] font-black px-1.5 py-0.5 rounded-full border border-rose-100 uppercase animate-pulse">Edited</span>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">By: {t.collectedBy || 'Admin'}</p>
                      </td>
                      <td className="px-8 py-5 text-right font-black text-slate-900 text-base">₹{t.amount.toLocaleString()}</td>
                      <td className="px-8 py-5 text-right flex items-center justify-end gap-2 text-slate-400">
                         <button 
                          onClick={() => setSelectedTxn(t)}
                          title="Print Receipt"
                          className="p-2 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                         >
                            <Printer size={18} />
                         </button>
                         <button 
                          onClick={() => {
                            setEditingTxnId(t.id);
                            setNewTransaction({
                              date: t.date.split('T')[0],
                              studentId: t.studentId,
                              transactionId: t.transactionId || '',
                              amount: t.amount,
                              mode: t.mode,
                              academicTerm: t.academicTerm,
                              remarks: t.remarks,
                            });
                            setIsModalOpen(true);
                          }}
                          title="Edit Transaction"
                          className="p-2 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                         >
                            <FileText size={18} />
                         </button>
                         <button 
                          title="Delete Transaction"
                          onClick={async () => {
                            if (window.confirm('Delete this payment record? This will restore the student balance.')) {
                              setData(prev => ({
                                ...prev,
                                transactions: prev.transactions.filter(item => item.id !== t.id)
                              }));
                              // Delete from Supabase
                              await supabase.from('payments').delete().eq('receipt_number', t.receiptNumber);
                            }
                          }}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                         >
                            <X size={18} />
                         </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {selectedTxn && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm no-print"
               onClick={() => setSelectedTxn(null)}
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               className="bg-white rounded-[32px] shadow-2xl w-full max-w-4xl relative z-10 overflow-hidden overflow-y-auto max-h-[95vh]"
             >
                <div className="p-6 bg-white border-b border-slate-100 flex items-center justify-center gap-4 no-print sticky top-0 z-20">
                   <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-100"
                   >
                     <Printer size={18} /> Print Receipt
                   </button>
                   <button 
                     onClick={() => {
                        const student = data.students.find(s => s.id === selectedTxn.studentId);
                        const inst = data.institution;
                        const text = `*FEE PAYMENT SUCCESSFUL*\n\nDear *${student?.name}*,\nYour payment has been received successfully.\n\n*Institution:* ${inst.name}\n*Amount:* ₹${selectedTxn.amount.toLocaleString()}\n*Receipt No:* ${selectedTxn.receiptNumber}\n*Date:* ${new Date(selectedTxn.date).toLocaleDateString('en-GB')}\n*Mode:* ${selectedTxn.mode}\n\n_This is a computer-generated receipt._\nThank you for choosing ${inst.name}!`;
                        window.open(`https://wa.me/${student?.phone ? student.phone.replace(/[^0-9]/g, '') : ''}?text=${encodeURIComponent(text)}`, '_blank');
                     }}
                     className="flex items-center gap-2 bg-[#25D366] text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-100 hover:scale-105 transition-transform"
                   >
                     <MessageSquare size={18} /> WhatsApp Receipt
                   </button>
                   <button 
                    onClick={() => setSelectedTxn(null)}
                    className="p-2.5 bg-white text-slate-400 hover:text-slate-800 rounded-xl border border-slate-200"
                   >
                     <X size={20} />
                   </button>
                </div>

                <div id="printable-receipt" className="p-4 sm:p-12 bg-white">
                  <div className="border border-slate-900 p-6 sm:p-10 relative rounded-sm">
                    <div className="flex items-center justify-between gap-6 mb-10 border-b-2 border-slate-900 pb-8">
                        <div className="flex items-center gap-6">
                            <div className="w-24 h-24 flex items-center justify-center border-2 border-slate-900 rounded-2xl p-2 overflow-hidden bg-white shadow-sm">
                              {data.institution.logo ? (
                                 <img src={data.institution.logo} alt="Logo" className="w-full h-full object-contain" />
                              ) : (
                                 <div className="w-full h-full bg-slate-900 rounded-xl flex items-center justify-center text-white font-black text-3xl uppercase">
                                    {data.institution.name?.substring(0, 2) || 'MG'}
                                 </div>
                              )}
                           </div>
                           <div>
                              <h1 className="text-3xl font-black text-slate-900 leading-tight uppercase tracking-tighter">
                                 {data.institution.name}
                              </h1>
                              <p className="text-[11px] font-bold text-slate-600 max-w-sm mt-1 leading-normal italic">
                                 {data.institution.address}
                              </p>
                              <p className="text-[11px] font-black text-slate-900 mt-2 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded inline-block">
                                 Phone: {data.institution.phone}
                              </p>
                           </div>
                        </div>
                       <div className="text-right">
                          <h2 className="text-xl font-black text-slate-900 mb-1 uppercase tracking-tighter">PAYMENT RECEIPT</h2>
                          <div className="space-y-0.5">
                            <p className="text-[11px] font-black text-slate-900 uppercase">
                              Date: {new Date().toLocaleDateString('en-GB') }
                            </p>
                            <p className="text-[11px] font-black text-slate-500 uppercase tracking-tighter">
                              Time: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </p>
                          </div>
                       </div>
                    </div>

                    <div className="grid grid-cols-2 gap-10 mb-8 border-b border-slate-200 pb-8">
                       <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Receipt No</p>
                          <p className="text-lg font-black text-slate-900">{selectedTxn.receiptNumber}</p>
                       </div>
                       <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Academic Session</p>
                          <p className="text-lg font-black text-slate-900">
                             {data.students.find(s => s.id === selectedTxn.studentId)?.session || 'N/A'}
                          </p>
                       </div>
                    </div>

                    <div className="mb-10">
                       <h3 className="text-xs font-black text-slate-900 uppercase underline decoration-slate-300 underline-offset-4 mb-6">Student Details</h3>
                       <div className="grid grid-cols-3 gap-y-7 gap-x-10">
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Student Name / Code</p>
                             <p className="text-xs font-black text-slate-900 uppercase">
                                {data.students.find(s => s.id === selectedTxn.studentId)?.name} / {data.students.find(s => s.id === selectedTxn.studentId)?.rollNumber}
                             </p>
                          </div>
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Father's Name</p>
                             <p className="text-xs font-black text-slate-900 uppercase">
                                {data.students.find(s => s.id === selectedTxn.studentId)?.guardianName || 'N/A'}
                             </p>
                          </div>
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Phone</p>
                             <p className="text-xs font-black text-slate-900">
                                {data.students.find(s => s.id === selectedTxn.studentId)?.phone || 'N/A'}
                             </p>
                          </div>

                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Branch</p>
                             <p className="text-xs font-black text-slate-900 uppercase">
                                {data.students.find(s => s.id === selectedTxn.studentId)?.branch}
                             </p>
                          </div>
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Semester</p>
                             <p className="text-xs font-black text-slate-900 uppercase">
                                {data.students.find(s => s.id === selectedTxn.studentId)?.semester}
                             </p>
                          </div>
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Session</p>
                             <p className="text-xs font-black text-slate-900 font-sans">
                                {data.students.find(s => s.id === selectedTxn.studentId)?.session}
                             </p>
                          </div>

                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Payment Mode</p>
                             <p className="text-xs font-black text-slate-900 uppercase">{selectedTxn.mode}</p>
                          </div>
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 text-slate-500">Transaction ID</p>
                             <p className="text-xs font-black text-slate-900 uppercase">
                                {selectedTxn.mode === 'Cash' ? 'N/A' : (selectedTxn.transactionId ? `M UTR ${selectedTxn.transactionId}` : 'N/A')}
                             </p>
                          </div>
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 text-emerald-600">Amount Paid</p>
                             <p className="text-lg font-black text-slate-900 font-sans">₹ {selectedTxn.amount.toFixed(2)}</p>
                          </div>
                       </div>
                    </div>

                    <div className="mt-16 flex flex-col items-end">
                       <p className="text-[10px] font-black text-slate-600 mb-2 uppercase tracking-wide">Authorized Signatory</p>
                       <div className="w-48 border-t border-slate-900 pt-1"></div>
                    </div>
                  </div>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                   <h3 className="text-3xl font-black text-slate-800 tracking-tight uppercase">Bulk Payment Import</h3>
                   <p className="text-slate-400 font-bold text-sm italic">Import transaction history from Excel or CSV</p>
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
                      placeholder="Paste your Excel/Table rows here...&#10;Format: Student, Transaction ID, Amount, Date&#10;Note: Student should be Name or Roll Number."
                      value={pasteData}
                      onChange={(e) => setPasteData(e.target.value)}
                    />
                  </div>
                )}

                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                   <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                     <FileText size={14} /> Supported Column Names
                   </h4>
                   <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {['Student/Roll', 'Amount', 'Date', 'Mode', 'Transaction ID', 'Term'].map(col => (
                        <div key={col} className="bg-white px-3 py-2 rounded-xl text-[10px] font-bold text-slate-600 border border-slate-200 flex items-center gap-2 shadow-sm">
                           <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                           {col}
                        </div>
                      ))}
                   </div>
                   <p className="text-[10px] text-slate-400 font-bold italic mt-4">* "Student" can be Roll Number, Name or Student ID.</p>
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

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 no-print">
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
                className="bg-white rounded-[40px] shadow-2xl w-full max-w-xl relative z-10 flex flex-col max-h-[90vh]"
              >
                <div className="p-10 border-b border-slate-100 flex items-center justify-between bg-slate-50/30 shrink-0">
                  <div>
                    <h3 className="text-3xl font-black text-slate-800 tracking-tight uppercase">
                      {editingTxnId ? 'Edit Payment' : 'Fee Collection'}
                    </h3>
                    {editingTxnId && (
                      <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mt-1">Changes will be logged in reports</p>
                    )}
                  </div>
                  <button 
                    onClick={() => { 
                      setIsModalOpen(false);
                      resetForm();
                    }}
                    className="p-3 bg-white text-slate-400 hover:text-slate-800 rounded-2xl shadow-sm transition-all"
                  >
                    <X size={24} />
                  </button>
                </div>

                <form onSubmit={handleSavePayment} className="flex flex-col h-full overflow-hidden">
                  <div className="p-10 space-y-8 overflow-y-auto custom-scrollbar flex-1">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 ml-1">Receipt Date</label>
                        <input 
                          required
                          type="date" 
                          className="w-full bg-white border-2 border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-bold text-slate-800 shadow-sm"
                          value={newTransaction.date}
                          onChange={(e) => setNewTransaction({...newTransaction, date: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 ml-1">Academic Term</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Sem IV" 
                          className="w-full bg-white border-2 border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-bold text-slate-800 shadow-sm"
                          value={newTransaction.academicTerm}
                          onChange={(e) => setNewTransaction({...newTransaction, academicTerm: e.target.value})}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 ml-1">Student</label>
                      <select 
                        required
                        disabled={!!editingTxnId}
                        className={`w-full bg-white border-2 border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-bold text-slate-800 shadow-sm transition-all ${editingTxnId ? 'opacity-50 cursor-not-allowed bg-slate-50' : ''}`}
                        value={newTransaction.studentId}
                        onChange={(e) => setNewTransaction({...newTransaction, studentId: e.target.value})}
                      >
                        <option value="">Search student by name or roll number...</option>
                        {data.students.map(s => <option key={s.id} value={s.id}>{s.name} - {s.rollNumber} ({s.branch} | Sem {s.semester})</option>)}
                      </select>
                      {newTransaction.studentId && (() => {
                        const student = data.students.find(s => s.id === newTransaction.studentId || s.rollNumber === newTransaction.studentId);
                        const plan = data.feePlans.find(p => p.id === student?.planId);
                        const paid = data.transactions
                          .filter(t => t.id !== editingTxnId && (t.studentId === student?.id || t.studentId === student?.rollNumber))
                          .reduce((sum, t) => sum + t.amount, 0);
                        return (
                          <div className="mt-4 p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                            <div className="flex justify-between items-start gap-4">
                              <div className="flex-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Student Details</p>
                                <p className="text-sm font-black text-slate-800 uppercase">{student?.name}</p>
                                <div className="flex gap-2 mt-1">
                                  <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-100 uppercase">{student?.branch}</span>
                                  <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-100 uppercase">Sem {student?.semester}</span>
                                  <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-100 uppercase">{student?.session}</span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                 <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest leading-none mb-1">Balance Due</p>
                                 <p className="text-xl font-black text-rose-700 italic">₹{((plan?.totalAmount || 0) - paid).toLocaleString()}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 ml-1">Transaction ID</label>
                    <input 
                      required={newTransaction.mode !== 'Cash'}
                      disabled={newTransaction.mode === 'Cash'}
                      type="text" 
                      placeholder={newTransaction.mode === 'Cash' ? 'N/A' : 'Enter UTR / Ref No.'}
                      className={`w-full bg-white border-2 border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono uppercase text-sm font-bold text-slate-800 shadow-sm ${
                        newTransaction.mode === 'Cash' ? 'opacity-50 grayscale cursor-not-allowed bg-slate-50 border-slate-100' : ''
                      }`}
                      value={newTransaction.transactionId}
                      onChange={(e) => setNewTransaction({...newTransaction, transactionId: e.target.value})}
                    />
                    {newTransaction.mode !== 'Cash' && (
                      <div className="flex items-center gap-2 mt-3 text-rose-600">
                        <AlertTriangle size={14} />
                        <p className="text-[10px] font-black uppercase tracking-wider">Duplicate ID check active</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 ml-1">Amount (₹)</label>
                      <input 
                        required
                        type="number" 
                        placeholder="0.00" 
                        className="w-full bg-white border-2 border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-black text-slate-800 shadow-sm text-2xl"
                        value={newTransaction.amount || ''}
                        onChange={(e) => setNewTransaction({...newTransaction, amount: Number(e.target.value)})}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 ml-1">Payment Mode</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {paymentModes.map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setNewTransaction({...newTransaction, mode})}
                          className={`py-3 px-4 rounded-xl text-xs font-black transition-all border-2 ${
                            newTransaction.mode === mode 
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-100' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 ml-1">Internal Remarks</label>
                    <textarea 
                      placeholder="Optional notes about this payment..." 
                      className="w-full bg-white border-2 border-slate-200 rounded-2xl px-6 py-4 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-bold text-sm h-24 resize-none text-slate-800 shadow-sm"
                      value={newTransaction.remarks}
                      onChange={(e) => setNewTransaction({...newTransaction, remarks: e.target.value})}
                    />
                  </div>
                </div>

                <div className="p-10 bg-slate-50 border-t border-slate-100 flex gap-4 shrink-0">
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsModalOpen(false);
                      resetForm();
                    }}
                    className="flex-1 bg-white border-2 border-slate-100 text-slate-400 font-bold py-5 rounded-3xl hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                  >
                    Discard
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-emerald-600 text-white font-bold py-5 rounded-3xl shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all uppercase tracking-widest text-xs"
                  >
                    {editingTxnId ? 'Update Payment' : 'Save Payment'}
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

