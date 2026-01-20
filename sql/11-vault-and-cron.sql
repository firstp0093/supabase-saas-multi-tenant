-- =====================================================
-- VAULT & CRON MANAGEMENT
-- Tenant-scoped secrets and job tracking
-- =====================================================

-- Enable required extensions (if not already enabled)
-- Note: These are typically enabled by default in Supabase
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pgsodium;

-- 1. Tenant secrets tracking table
-- Links vault.secrets to tenants/users
CREATE TABLE IF NOT EXISTS public.tenant_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT DEFAULT 'tenant' CHECK (scope IN ('global', 'tenant', 'user')),
    
    -- Link to actual vault secret
    vault_secret_id UUID,
    
    -- Metadata
    last_used_at TIMESTAMPTZ,
    use_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id, name)
);

-- 2. Cron job tracking table
-- Extends pg_cron with tenant association
CREATE TABLE IF NOT EXISTS public.cron_job_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    
    job_name TEXT NOT NULL UNIQUE,
    description TEXT,
    category TEXT,  -- 'cleanup', 'sync', 'report', 'billing', etc.
    
    -- pg_cron reference
    cron_job_id BIGINT,  -- jobid from cron.job
    schedule TEXT NOT NULL,
    command TEXT NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_system BOOLEAN DEFAULT false,  -- System jobs can't be deleted by users
    
    -- Monitoring
    last_run_at TIMESTAMPTZ,
    last_run_status TEXT,
    last_run_duration_ms INTEGER,
    total_runs INTEGER DEFAULT 0,
    total_failures INTEGER DEFAULT 0,
    
    -- Alerts
    alert_on_failure BOOLEAN DEFAULT true,
    alert_email TEXT,
    consecutive_failures INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Cron job run history (more detailed than cron.job_run_details)
CREATE TABLE IF NOT EXISTS public.cron_job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES public.cron_job_registry(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    status TEXT DEFAULT 'running',  -- 'running', 'success', 'failed', 'timeout'
    result_message TEXT,
    error_message TEXT,
    
    -- Context
    triggered_by TEXT DEFAULT 'schedule',  -- 'schedule', 'manual', 'api'
    triggered_by_user UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_secrets_tenant ON public.tenant_secrets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_secrets_user ON public.tenant_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_secrets_name ON public.tenant_secrets(name);
CREATE INDEX IF NOT EXISTS idx_cron_job_registry_tenant ON public.cron_job_registry(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cron_job_registry_name ON public.cron_job_registry(job_name);
CREATE INDEX IF NOT EXISTS idx_cron_job_registry_active ON public.cron_job_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job ON public.cron_job_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_started ON public.cron_job_runs(started_at DESC);

-- RLS
ALTER TABLE public.tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_job_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;

-- Tenant secrets: users see their tenant's secrets, admins see all scopes
CREATE POLICY "Tenant isolation" ON public.tenant_secrets
    FOR SELECT USING (
        tenant_id = public.get_current_tenant_id()
        OR scope = 'global'
    );

CREATE POLICY "Admins can manage" ON public.tenant_secrets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_tenants
            WHERE tenant_id = tenant_secrets.tenant_id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
        OR auth.role() = 'service_role'
    );

-- Cron jobs: service role only for management, users can view their tenant's jobs
CREATE POLICY "Tenant can view jobs" ON public.cron_job_registry
    FOR SELECT USING (
        tenant_id = public.get_current_tenant_id()
        OR tenant_id IS NULL  -- System jobs visible to all
    );

CREATE POLICY "Service role manages" ON public.cron_job_registry
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Tenant can view runs" ON public.cron_job_runs
    FOR SELECT USING (
        tenant_id = public.get_current_tenant_id()
        OR tenant_id IS NULL
    );

CREATE POLICY "Service role manages" ON public.cron_job_runs
    FOR ALL USING (auth.role() = 'service_role');

-- 4. Helper function to list cron jobs
CREATE OR REPLACE FUNCTION public.list_cron_jobs()
RETURNS TABLE (
    jobid BIGINT,
    jobname TEXT,
    schedule TEXT,
    command TEXT,
    active BOOLEAN,
    database TEXT,
    username TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.jobid,
        j.jobname::TEXT,
        j.schedule::TEXT,
        j.command::TEXT,
        j.active,
        j.database::TEXT,
        j.username::TEXT
    FROM cron.job j
    ORDER BY j.jobname;
END;
$$;

-- 5. Seed: Example system cron jobs
INSERT INTO public.cron_job_registry (job_name, description, category, schedule, command, is_system, alert_on_failure) VALUES
('cleanup-old-activity-logs', 'Delete activity logs older than 90 days', 'cleanup', '0 3 * * *', 
 'DELETE FROM public.activity_log WHERE created_at < now() - interval ''90 days''', true, true),
('cleanup-expired-invites', 'Delete expired team invites', 'cleanup', '0 4 * * *',
 'DELETE FROM public.invites WHERE expires_at < now() AND accepted_at IS NULL', true, false),
('cleanup-old-email-logs', 'Delete email logs older than 30 days', 'cleanup', '0 5 * * *',
 'DELETE FROM public.email_log WHERE sent_at < now() - interval ''30 days''', true, false),
('reset-monthly-usage', 'Reset monthly usage counters on 1st of month', 'billing', '0 0 1 * *',
 'UPDATE public.tenants SET usage_reset_at = now() WHERE usage_reset_at < date_trunc(''month'', now())', true, true),
('check-service-health', 'Run service health checks every 5 minutes', 'monitoring', '*/5 * * * *',
 'SELECT net.http_post(url := current_setting(''app.supabase_url'') || ''/functions/v1/check-service-health'', headers := jsonb_build_object(''X-Cron-Secret'', current_setting(''app.cron_secret'')))', true, true)
ON CONFLICT (job_name) DO UPDATE SET
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    schedule = EXCLUDED.schedule,
    command = EXCLUDED.command,
    updated_at = now();

-- Note: To actually activate these cron jobs, run:
-- SELECT cron.schedule('job-name', 'schedule', 'command');
-- This is done via the manage-cron Edge Function
