import { AppData } from './types';

export const INITIAL_DATA: AppData = {
  institution: {
    name: 'Maya Group of Institutions',
    address: 'Plot No. 45, Sector 18, Gurugram, Haryana - 122015',
    phone: '+91 124 456 7890',
  },
  students: [],
  transactions: [],
  feePlans: [],
  staff: [
    { id: 'admin', name: 'Super Admin', role: 'Administrator', phone: '9876543210', pin: 'adminDC@12345' }
  ],
  masters: {
    branches: ['CSE', 'ME', 'CE', 'ECE', 'EE'],
    semesters: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
    sessions: ['2023-24', '2024-25', '2025-26'],
  },
  hasSeeded: false,
};

export const COLORS = {
  primary: '#059669', // Emerald 600
  secondary: '#10b981', // Emerald 500
  accent: '#34d399', // Emerald 400
  background: '#f8fafc',
  card: '#ffffff',
  text: '#1e293b',
  textMuted: '#64748b',
};
