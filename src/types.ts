export type PaymentMode = 'Cash' | 'UPI' | 'Card' | 'Bank Transfer';

export interface FeeComponent {
  id: string;
  name: string;
  amount: number;
}

export interface FeePlan {
  id: string;
  name: string;
  frequency: 'Semester' | 'Yearly';
  components: FeeComponent[];
  totalAmount: number;
}

export interface Student {
  id: string;
  name: string;
  guardianName: string;
  planId: string;
  branch: string;
  semester: string;
  session: string;
  rollNumber: string;
  phone: string;
  email: string;
  enrollmentDate: string;
}

export interface Transaction {
  id: string;
  studentId: string;
  amount: number;
  date: string;
  time: string;
  mode: PaymentMode;
  transactionId?: string; // UPI/Card ref
  academicTerm: string;
  receiptNumber: string;
  remarks?: string;
  feeHeadIds?: string[];
  collectedBy?: string;
  isEdited?: boolean;
  editedBy?: string;
  editReason?: string;
}

export interface InstitutionProfile {
  name: string;
  address: string;
  phone: string;
  logo?: string;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  phone: string;
  pin: string;
}

export interface AppData {
  institution: InstitutionProfile;
  feePlans: FeePlan[];
  students: Student[];
  transactions: Transaction[];
  staff: Staff[];
  masters: {
    branches: string[];
    semesters: string[];
    sessions: string[];
  };
  hasSeeded?: boolean;
}
