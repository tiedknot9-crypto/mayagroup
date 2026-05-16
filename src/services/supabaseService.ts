import { supabase } from '../lib/supabase';
import { AppData, Student, Transaction, FeePlan, Staff } from '../types';

export const supabaseService = {
  async checkHealth() {
    try {
      const { data, error } = await supabase.from('settings').select('count', { count: 'exact', head: true });
      return {
        connected: !error || error.code !== 'PGRST116',
        tablesExist: error?.code !== '42P01',
        error: error ? `${error.code}: ${error.message}` : null
      };
    } catch (err) {
      return { connected: false, tablesExist: false, error: String(err) };
    }
  },

  isValidUuid(uuid: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  },

  async fetchAppData(): Promise<AppData | null> {
    try {
      // Diagnostic check: verify tables exist
      const { error: healthError } = await supabase.from('settings').select('count', { count: 'exact', head: true });
      if (healthError && healthError.code === '42P01') {
        console.error('[Supabase] CRITICAL: Tables NOT FOUND. Please run the SQL Fix Script in Supabase Editor.');
        return null;
      }
      const [settingsRes, coursesRes, studentsRes, paymentsRes, staffRes] = await Promise.all([
        supabase.from('settings').select('*').single(),
        supabase.from('courses').select('*, fee_heads(*)'),
        supabase.from('students').select('*'),
        supabase.from('payments').select('*').order('payment_date', { ascending: false }),
        supabase.from('accountants').select('*')
      ]);

      if (settingsRes.error && settingsRes.error.code !== 'PGRST116') {
        if (settingsRes.error.code === '42501') {
          console.info('[Supabase] Permission denied for "settings" table. You likely executed the V15/V17 script without enabling Anon Auth or forgot to GRANT access to anon role.');
        } else {
          console.warn('Settings fetch error:', settingsRes.error);
        }
      }
      
      if (coursesRes.error) {
        if (coursesRes.error.code === '42501') {
          console.info('[Supabase] Permission denied for "courses" table.');
        } else {
          console.warn('Courses fetch error:', coursesRes.error);
        }
      }

      if (studentsRes.error) {
        if (studentsRes.error.code === '42501') {
          console.info('[Supabase] Permission denied for "students" table.');
        } else {
          console.warn('Students fetch error:', studentsRes.error);
        }
      }

      if (paymentsRes.error) {
        if (paymentsRes.error.code === '42501') {
          console.info('[Supabase] Permission denied for "payments" table.');
        } else {
          console.warn('Payments fetch error:', paymentsRes.error);
        }
      }

      if (staffRes.error) {
        if (staffRes.error.code === '42501') {
          console.info('[Supabase] Permission denied for "accountants" (staff) table.');
        } else {
          console.warn('Staff fetch error:', staffRes.error);
        }
      }

      const settingsData = settingsRes.data;
      const coursesData = coursesRes.data;
      const studentsData = studentsRes.data;
      const paymentsData = paymentsRes.data;
      const staffData = staffRes.data;

      // Detect if we actually reached Supabase but just don't have access or data
      const hasPermissionError = [settingsRes, coursesRes, studentsRes, paymentsRes, staffRes].some(r => r.error?.code === '42501');
      const hasConnectionError = [settingsRes, coursesRes, studentsRes, paymentsRes, staffRes].some(r => r.error && r.error.code !== 'PGRST116' && r.error.code !== '42501');

      // If we have no data at all and encountered errors that aren't just "missing rows"
      if (!settingsData && (!studentsData || studentsData.length === 0) && (!staffData || staffData.length === 0)) {
        if (hasPermissionError) {
          console.warn('[Supabase] Connection established but access is denied to core tables. Please check RLS policies.');
        } else if (hasConnectionError) {
          console.warn('[Supabase] Connection error or timeout (possible Cold Start). Using local fallback data.');
        } else {
          console.info('[Supabase] Connected to an empty database. Using local defaults.');
        }
        
        if (hasConnectionError) return null;
      }

      // Transform back to AppData format with safe defaults
      const appData: AppData = {
        institution: {
          name: settingsData?.institution_name || 'MAYA Group',
          address: settingsData?.address || '',
          phone: settingsData?.contact_number || '',
          logo: settingsData?.logo_url || undefined,
        },
        masters: {
          branches: settingsData?.available_branches || [],
          semesters: settingsData?.available_semesters || [],
          sessions: settingsData?.available_sessions || [],
        },
        feePlans: (coursesData || []).map(course => ({
          id: course.id,
          name: course.course_name,
          frequency: course.frequency as 'Semester' | 'Yearly',
          totalAmount: Number(course.total_amount),
          components: (course.fee_heads || []).map((head: any) => ({
            id: head.id,
            name: head.name,
            amount: Number(head.amount),
          })),
        })),
        students: (studentsData || []).map(s => ({
          id: s.id,
          name: s.name || 'Unnamed',
          guardianName: s.parent_name || '',
          planId: s.course_id || '',
          branch: s.branch || '',
          semester: s.semester || '',
          session: s.session_id || '',
          rollNumber: s.roll_number || '',
          phone: s.phone || '',
          email: s.email || '',
          enrollmentDate: s.enrollment_date || new Date().toISOString(),
        })),
        transactions: (paymentsData || []).map(p => ({
          id: p.id,
          studentId: p.student_id,
          amount: Number(p.amount),
          date: p.payment_date || new Date().toISOString(),
          time: p.time || '',
          mode: p.payment_method as any,
          transactionId: p.transaction_id || undefined,
          academicTerm: p.session_id || 'Current',
          receiptNumber: p.receipt_number,
          remarks: p.remarks || '',
          feeHeadIds: p.fee_head_ids || [],
          collectedBy: p.collected_by || '',
          isEdited: p.is_edited || false,
          editedBy: p.edited_by || '',
          editReason: p.edit_reason || '',
        })),
        staff: (staffData || []).map(s => ({
          id: s.user_id,
          name: s.name,
          role: s.role || 'Staff',
          phone: s.phone || '',
          pin: s.password,
        })),
        hasSeeded: true
      };

      return appData;
    } catch (err) {
      console.error('Critical failure in supabaseService.fetchAppData:', err);
      return null;
    }
  },

  async saveStudent(student: Student) {
    // Validate UUID or remove it to let DB generate one
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(student.id);
    
    let courseId = student.planId;
    const isCourseIdValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId);
    
    if (!isCourseIdValid || courseId === '00000000-0000-0000-0000-000000000000') {
      courseId = await this.ensureDefaultCourse();
    }

    const { error } = await supabase.from('students').upsert({
      ...(isUuid ? { id: student.id } : {}),
      name: student.name,
      parent_name: student.guardianName,
      roll_number: student.rollNumber,
      course_id: courseId,
      branch: student.branch,
      semester: student.semester,
      session_id: student.session,
      phone: student.phone,
      email: student.email,
      enrollment_date: student.enrollmentDate,
    }, { onConflict: 'roll_number' });

    if (error) {
      console.error('Error saving student to Supabase:', error);
      throw error;
    }
  },

  async saveTransaction(txn: Transaction) {
    // First, verify we have the student's DB UUID by their roll number if needed
    // This is the most robust way to sync because studentId might be a temporary local ID
    let finalStudentId = txn.studentId;
    
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txn.studentId);
    
    if (!isUuid) {
       // Attempt to find student by roll number if the current ID isn't a UUID
       const { data: sData } = await supabase.from('students').select('id').eq('roll_number', txn.studentId).single();
       if (sData) finalStudentId = sData.id;
    }

    const { error } = await supabase.from('payments').upsert({
      student_id: finalStudentId,
      amount: txn.amount,
      payment_date: txn.date,
      time: txn.time,
      payment_method: txn.mode,
      receipt_number: txn.receiptNumber,
      transaction_id: txn.transactionId,
      session_id: txn.academicTerm,
      remarks: txn.remarks,
      fee_head_ids: txn.feeHeadIds,
      collected_by: txn.collectedBy,
      is_edited: txn.isEdited,
      edited_by: txn.editedBy,
      edit_reason: txn.editReason,
    }, { onConflict: 'receipt_number' });

    if (error) {
      console.error('Error saving transaction to Supabase:', error);
      if (error.code === '42501') {
        console.warn('Supabase Permission Denied: Payment write blocked. Check your RLS policies.');
      }
      throw error;
    }
  },

  async ensureDefaultCourse(): Promise<string> {
    const { data: existing } = await supabase.from('courses').select('id').limit(1).single();
    if (existing) return existing.id;

    // Create a default course if none exist
    const { data: created, error } = await supabase.from('courses').insert({
      course_name: 'General Course',
      frequency: 'Yearly',
      total_amount: 0
    }).select().single();

    if (error || !created) {
      console.error('Failed to create default course:', error);
      throw new Error('Default course creation failed and no courses exist.');
    }
    return created.id;
  },

  async bulkSaveStudents(students: Student[]) {
    // Determine a valid course_id for students with invalid/missing ones
    let defaultCourseId: string | null = null;
    
    // Transform to DB format
    const dbStudents = [];
    for (const s of students) {
      let courseId = s.planId;
      const isCourseIdValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId);
      
      if (!isCourseIdValid || courseId === '00000000-0000-0000-0000-000000000000') {
        if (!defaultCourseId) {
          defaultCourseId = await this.ensureDefaultCourse();
        }
        courseId = defaultCourseId;
      }

      dbStudents.push({
        id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.id) ? s.id : undefined,
        name: s.name,
        parent_name: s.guardianName,
        roll_number: s.rollNumber,
        course_id: courseId,
        branch: s.branch,
        semester: s.semester,
        session_id: s.session,
        phone: s.phone,
        email: s.email,
        enrollment_date: s.enrollmentDate,
      });
    }

    const { error } = await supabase.from('students').upsert(dbStudents, { onConflict: 'roll_number' });
    if (error) {
      console.error('Error in bulkSaveStudents:', error);
      throw error;
    }
  },

  async bulkSaveTransactions(txns: Transaction[]) {
    // Transactions need the student's DB UUID. 
    // We also filter out any invalid dates to prevent "Invalid time value" errors.
    const dbTxns = [];
    
    for (const txn of txns) {
      try {
        const d = new Date(txn.date);
        if (isNaN(d.getTime())) continue;

        let finalStudentId = txn.studentId;
        if (!this.isValidUuid(finalStudentId)) {
          // If rollNumber was passed as studentId (common in manual imports)
          const { data: sData } = await supabase.from('students').select('id').eq('roll_number', txn.studentId).single();
          if (sData) {
            finalStudentId = sData.id;
          } else {
            console.warn(`[Supabase] Skipping transaction for unknown student roll/ID: ${txn.studentId}`);
            continue;
          }
        }

        dbTxns.push({
          student_id: finalStudentId, 
          amount: txn.amount,
          payment_date: d.toISOString(),
          time: txn.time || '00:00:00',
          payment_method: txn.mode,
          receipt_number: txn.receiptNumber,
          transaction_id: txn.transactionId || null,
          session_id: txn.academicTerm,
          remarks: txn.remarks,
          fee_head_ids: txn.feeHeadIds,
          collected_by: txn.collectedBy,
          is_edited: txn.isEdited,
          edited_by: txn.editedBy,
          edit_reason: txn.editReason,
        });
      } catch (e) {
        console.error('Error processing transaction for bulk save:', txn, e);
      }
    }

    if (dbTxns.length === 0) return;

    // Logic to handle potential transaction_id collisions:
    // If we have transaction_ids, we try to upsert targeting them to prevent 23505 errors.
    // However, some might be null. 
    // Best strategy for demo: Upsert on receipt_number, but if it fails due to transaction_id, 
    // we log it and try to filter out duplicates manually.
    const { error } = await supabase.from('payments').upsert(dbTxns, { 
      onConflict: 'receipt_number',
      ignoreDuplicates: false 
    });

    if (error) {
      console.error('Error in bulkSaveTransactions:', error);
      
      // If duplicate transaction_id error (23505), try a more resilient approach:
      if (error.code === '23505') {
         console.warn('Duplicate transaction ID detected. Attempting individual sync as fallback...');
         for (const txn of dbTxns) {
           try {
             // Try to upsert individually; if it fails, it won't block the whole batch
             await supabase.from('payments').upsert(txn, { onConflict: 'receipt_number' });
           } catch (e) {
             console.error('Failed to sync individual transaction:', txn.receipt_number, e);
           }
         }
      } else {
        throw error;
      }
    }
  },

  async clearAllData() {
    try {
      // 1. Delete all payments first (child records)
      const { error: pError } = await supabase
        .from('payments')
        .delete()
        .not('id', 'is', null); // Robust way to delete everything if id exists
      
      if (pError) throw pError;

      // 2. Delete all students
      const { error: sError } = await supabase
        .from('students')
        .delete()
        .not('id', 'is', null);
      
      if (sError) throw sError;

      return true;
    } catch (err) {
      console.error('Failed to clear database records:', err);
      throw err;
    }
  },

  async updateSettings(institution: any, masters: any) {
    const { data: existing } = await supabase.from('settings').select('id').single();
    
    const payload = {
      institution_name: institution.name,
      address: institution.address,
      contact_number: institution.phone,
      logo_url: institution.logo,
      available_branches: masters.branches,
      available_semesters: masters.semesters,
      available_sessions: masters.sessions,
    };

    if (existing) {
      await supabase.from('settings').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('settings').insert(payload);
    }
  },

  async saveFeePlan(plan: FeePlan): Promise<FeePlan | null> {
    const { data: course, error: cError } = await supabase.from('courses').upsert({
      course_name: plan.name,
      frequency: plan.frequency,
      total_amount: plan.totalAmount
    }, { onConflict: 'course_name' }).select().single();

    if (cError || !course) {
      console.error('Error saving fee plan:', cError);
      return null;
    }

    // Save components
    const finalComponents: any[] = [];
    for (const comp of plan.components) {
      const { data: head } = await supabase.from('fee_heads').upsert({
        course_id: course.id,
        name: comp.name,
        amount: comp.amount,
        type: 'Base'
      }, { onConflict: 'course_id,name' }).select().single();
      
      if (head) {
        finalComponents.push({
          id: head.id,
          name: head.name,
          amount: Number(head.amount)
        });
      }
    }

    return {
      id: course.id,
      name: course.course_name,
      frequency: course.frequency as any,
      totalAmount: Number(course.total_amount),
      components: finalComponents.length > 0 ? finalComponents : plan.components
    };
  }
};
