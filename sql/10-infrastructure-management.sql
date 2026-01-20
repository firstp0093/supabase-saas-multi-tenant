-- =====================================================
-- INFRASTRUCTURE MANAGEMENT
-- Functions needed for AI-driven self-management
-- =====================================================

-- 1. Function to execute raw SQL (for manage-database)
-- WARNING: This is powerful. Only accessible via service role.
CREATE OR REPLACE FUNCTION public.exec_sql(query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  EXECUTE query;
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 2. Function to get table info
CREATE OR REPLACE FUNCTION public.get_tables_info()
RETURNS TABLE (
  table_name TEXT,
  column_count BIGINT,
  has_tenant_id BOOLEAN,
  rls_enabled BOOLEAN,
  row_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.table_name::TEXT,
    (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = 'public') as column_count,
    EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = 'public' AND c.column_name = 'tenant_id') as has_tenant_id,
    COALESCE((SELECT relrowsecurity FROM pg_class WHERE relname = t.table_name AND relnamespace = 'public'::regnamespace), false) as rls_enabled,
    0::BIGINT as row_count  -- Actual count would be slow
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name;
END;
$$;

-- 3. Function registry table (track what functions exist and their purpose)
CREATE TABLE IF NOT EXISTS public.function_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT NOT NULL UNIQUE,
    description TEXT,
    category TEXT,  -- 'tenant', 'billing', 'deployment', 'infrastructure', etc.
    
    -- Code tracking
    current_version INTEGER DEFAULT 1,
    code_hash TEXT,  -- SHA256 of the code for change detection
    last_deployed_at TIMESTAMPTZ,
    
    -- Monitoring
    is_active BOOLEAN DEFAULT true,
    is_critical BOOLEAN DEFAULT false,  -- Cannot be deleted if true
    
    -- Usage stats (updated by monitoring)
    total_invocations BIGINT DEFAULT 0,
    total_errors BIGINT DEFAULT 0,
    avg_duration_ms INTEGER,
    last_invoked_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error_message TEXT,
    
    -- Dependencies
    depends_on TEXT[] DEFAULT '{}',  -- Other functions this depends on
    required_secrets TEXT[] DEFAULT '{}',  -- Secrets this function needs
    required_tables TEXT[] DEFAULT '{}',  -- Tables this function uses
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Function invocation log (for monitoring)
CREATE TABLE IF NOT EXISTS public.function_invocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name TEXT NOT NULL,
    
    -- Request info
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    user_id UUID,
    
    -- Execution
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Result
    status TEXT DEFAULT 'started',  -- 'started', 'success', 'error'
    status_code INTEGER,
    error_message TEXT,
    
    -- Context
    request_id TEXT,
    ip_address TEXT,
    user_agent TEXT
);

-- 5. Schema change log
CREATE TABLE IF NOT EXISTS public.schema_changelog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    migration_name TEXT,
    sql_executed TEXT NOT NULL,
    executed_by TEXT,  -- 'manual', 'ai', 'migration'
    
    -- Result
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    
    -- Rollback
    rollback_sql TEXT,
    rolled_back_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_function_registry_category ON public.function_registry(category);
CREATE INDEX IF NOT EXISTS idx_function_registry_active ON public.function_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_function_invocations_name ON public.function_invocations(function_name);
CREATE INDEX IF NOT EXISTS idx_function_invocations_tenant ON public.function_invocations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_function_invocations_started ON public.function_invocations(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_invocations_status ON public.function_invocations(status);
CREATE INDEX IF NOT EXISTS idx_schema_changelog_created ON public.schema_changelog(created_at DESC);

-- RLS (these are admin-only tables, no tenant access)
ALTER TABLE public.function_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.function_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_changelog ENABLE ROW LEVEL SECURITY;

-- Only service role can access these
CREATE POLICY "Service role only" ON public.function_registry
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role only" ON public.function_invocations
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role only" ON public.schema_changelog
    FOR ALL USING (auth.role() = 'service_role');

-- Seed: Register current functions
INSERT INTO public.function_registry (function_name, description, category, is_critical, required_secrets, required_tables) VALUES
('provision-tenant', 'Create new tenant with Stripe customer', 'tenant', true, ARRAY['STRIPE_TEST_SECRET_KEY'], ARRAY['tenants', 'user_tenants']),
('invite-team-member', 'Send team invite with email', 'tenant', false, ARRAY['RESEND_FULL'], ARRAY['invites', 'user_tenants', 'domains']),
('accept-invite', 'Accept team invitation', 'tenant', false, ARRAY[]::TEXT[], ARRAY['invites', 'user_tenants']),
('manage-domain', 'Add, verify, delete domains', 'domain', false, ARRAY['RESEND_FULL'], ARRAY['domains']),
('create-checkout', 'Stripe checkout session', 'billing', true, ARRAY['STRIPE_TEST_SECRET_KEY'], ARRAY['tenants']),
('customer-portal', 'Stripe billing portal', 'billing', false, ARRAY['STRIPE_TEST_SECRET_KEY'], ARRAY['tenants']),
('stripe-webhook', 'Handle Stripe events', 'billing', true, ARRAY['STRIPE_WEBHOOK_SECRET'], ARRAY['tenants']),
('check-usage-limits', 'Verify plan limits', 'billing', false, ARRAY[]::TEXT[], ARRAY['plan_limits', 'usage_records']),
('track-usage', 'Record usage events', 'billing', false, ARRAY[]::TEXT[], ARRAY['usage_records', 'usage_events']),
('setup-page', 'Get injectable snippets', 'deployment', false, ARRAY[]::TEXT[], ARRAY['pages']),
('deploy-page', 'Push to Cloudflare Pages', 'deployment', false, ARRAY['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], ARRAY['pages', 'page_deployments']),
('gads-message-match', 'Dynamic ad content', 'deployment', false, ARRAY[]::TEXT[], ARRAY['pages', 'gads_impressions']),
('discover-services', 'List available services', 'services', false, ARRAY[]::TEXT[], ARRAY['services', 'tenant_services']),
('configure-service', 'Enable/configure service', 'services', false, ARRAY[]::TEXT[], ARRAY['services', 'tenant_services']),
('check-service-health', 'Monitor service status', 'services', false, ARRAY[]::TEXT[], ARRAY['services', 'service_status']),
('update-service-catalog', 'Admin: manage services', 'services', false, ARRAY['ADMIN_KEY'], ARRAY['services']),
('create-api-key', 'Generate API key', 'developer', false, ARRAY[]::TEXT[], ARRAY['api_keys']),
('validate-api-key', 'Verify API key', 'developer', false, ARRAY[]::TEXT[], ARRAY['api_keys']),
('log-activity', 'Record audit events', 'developer', false, ARRAY[]::TEXT[], ARRAY['activity_log']),
('manage-functions', 'CRUD Edge Functions', 'infrastructure', true, ARRAY['SUPABASE_ACCESS_TOKEN', 'ADMIN_KEY'], ARRAY['activity_log']),
('manage-secrets', 'CRUD Edge secrets', 'infrastructure', true, ARRAY['SUPABASE_ACCESS_TOKEN', 'ADMIN_KEY'], ARRAY['activity_log']),
('manage-database', 'CRUD database tables', 'infrastructure', true, ARRAY['ADMIN_KEY'], ARRAY['activity_log', 'schema_changelog'])
ON CONFLICT (function_name) DO UPDATE SET
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_critical = EXCLUDED.is_critical,
  required_secrets = EXCLUDED.required_secrets,
  required_tables = EXCLUDED.required_tables,
  updated_at = now();
