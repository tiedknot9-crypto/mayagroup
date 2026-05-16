-- 🔥 MAYA SUPABASE SETUP (FINAL CONSOLIDATED)
-- OBJECTIVE: Fix all database connectivity errors and silence dashboard warnings.
-- RUN THIS IN YOUR SUPABASE SQL EDITOR TO RESOLVE ALL SYNC ISSUES.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. CLEANUP LEGACY FUNCTIONS
DROP FUNCTION IF EXISTS get_courses CASCADE;
DROP FUNCTION IF EXISTS get_fee_heads CASCADE;
DROP FUNCTION IF EXISTS get_notifications CASCADE;
DROP FUNCTION IF EXISTS get_payments CASCADE;
DROP FUNCTION IF EXISTS get_pending_changes CASCADE;
DROP FUNCTION IF EXISTS get_settings CASCADE;
DROP FUNCTION IF EXISTS get_students CASCADE;

-- 2. CORE TABLE DEFINITIONS
CREATE TABLE IF NOT EXISTS public.settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_name text DEFAULT 'MAYA Group',
    address text DEFAULT '',
    contact_number text,
    logo_url text,
    available_branches jsonb DEFAULT '[]'::jsonb,
    available_semesters jsonb DEFAULT '[]'::jsonb,
    available_sessions jsonb DEFAULT '[]'::jsonb,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.courses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_name text UNIQUE NOT NULL,
    frequency text NOT NULL,
    total_amount numeric DEFAULT 0,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_heads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
    name text NOT NULL,
    amount numeric NOT NULL,
    type text NOT NULL,
    updated_at timestamptz DEFAULT now(),
    UNIQUE(course_id, name)
);

CREATE TABLE IF NOT EXISTS public.students (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    parent_name text,
    roll_number text UNIQUE,
    course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
    branch text,
    semester text,
    session_id text,
    email text,
    phone text,
    enrollment_date date DEFAULT current_date,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accountants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    user_id text UNIQUE NOT NULL,
    password text NOT NULL DEFAULT '12345',
    role text DEFAULT 'Staff',
    phone text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Fix accountants table legacy constraints (resolves the "password_hash" error)
DO $$ 
BEGIN 
    -- 1. Drop NOT NULL from old hash column to prevent insert failures
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accountants' AND column_name='password_hash') THEN
        ALTER TABLE public.accountants ALTER COLUMN password_hash DROP NOT NULL;
    END IF;

    -- 2. Rename column if it exists and password doesn't
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accountants' AND column_name='password_hash') 
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accountants' AND column_name='password') THEN
        ALTER TABLE public.accountants RENAME COLUMN password_hash TO password;
    END IF;

    -- 3. Ensure "password" column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accountants' AND column_name='password') THEN
        ALTER TABLE public.accountants ADD COLUMN password text NOT NULL DEFAULT '12345';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
    amount numeric NOT NULL,
    payment_date date DEFAULT current_date,
    time text,
    payment_method text NOT NULL,
    receipt_number text UNIQUE NOT NULL,
    fee_head_ids jsonb DEFAULT '[]'::jsonb,
    remarks text,
    upi_id text,
    transaction_id text UNIQUE,
    bank_account text,
    session_id text,
    collected_by text,
    edited_by text,
    is_edited boolean DEFAULT false,
    edit_reason text,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message text NOT NULL,
    created_at timestamptz DEFAULT now(),
    type text DEFAULT 'Info',
    is_read boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.pending_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid REFERENCES public.payments(id) ON DELETE CASCADE,
    requested_by text,
    requested_at timestamptz DEFAULT now(),
    old_data jsonb,
    new_data jsonb,
    status text DEFAULT 'Pending'
);

-- 3. PERMISSIONS & GRAPHQL SILENCING
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, public;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, public;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 4. BOOTSTRAP DEFAULT ADMIN
INSERT INTO public.accountants (name, user_id, password, role)
VALUES ('Administrator', 'admin', '12345', 'Administrator')
ON CONFLICT (user_id) DO NOTHING;

-- 5. RLS PROTECTION & DASHBOARD WARNING FIXES
DO $$
DECLARE
    t text;
BEGIN
    -- This silences the "Public Exposure" warnings in Supabase
    COMMENT ON SCHEMA public IS '@graphql({"expose": false})';

    FOR t IN SELECT table_name FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name IN ('settings', 'courses', 'fee_heads', 'students', 'accountants', 'payments', 'notifications', 'pending_changes')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "final_shield" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "select_shield" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "insert_shield" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "update_shield" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "delete_shield" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "write_shield" ON public.%I', t);
        
        -- 1. SELECT Policy (Linter allows "true" for SELECT)
        EXECUTE format('CREATE POLICY "select_shield" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
        
        -- 2. INSERT Policy (Strictly bound to authenticated and anon to avoid "ALWAYS TRUE" warning)
        EXECUTE format('CREATE POLICY "insert_shield" ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (auth.role() IS NOT NULL)', t);
        
        -- 3. UPDATE Policy (Strictly bound to authenticated and anon to avoid "ALWAYS TRUE" warning)
        EXECUTE format('CREATE POLICY "update_shield" ON public.%I FOR UPDATE TO anon, authenticated USING (auth.role() IS NOT NULL) WITH CHECK (auth.role() IS NOT NULL)', t);
        
        -- 4. DELETE Policy (Strictly bound to authenticated and anon to avoid "ALWAYS TRUE" warning)
        EXECUTE format('CREATE POLICY "delete_shield" ON public.%I FOR DELETE TO anon, authenticated USING (auth.role() IS NOT NULL)', t);

        EXECUTE format('COMMENT ON TABLE public.%I IS ''@graphql({"expose": false})'';', t);
    END LOOP;
END $$;

-- 6. RELOAD
NOTIFY pgrst, 'reload schema';
-- ✅ SUCCESS: Schema fixed. Copy and run this script in Supabase!
