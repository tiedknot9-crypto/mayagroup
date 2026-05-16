import { createClient } from '@supabase/supabase-js';

// Supabase credentials from user request
const DEFAULT_URL = 'https://uuunwliqnwpocezwmksf.supabase.co';
const DEFAULT_KEY = 'sb_publishable_MUbkBMiHQfKw3Y3hdN_qaQ_eg9JkQvM';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isUsingDefaults = !import.meta.env.VITE_SUPABASE_URL;
const finalUrl = supabaseUrl || DEFAULT_URL;
const finalKey = supabaseAnonKey || DEFAULT_KEY;

export const supabase = createClient(finalUrl, finalKey);
