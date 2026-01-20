-- =====================================================
-- STEP 3: PAGE DEPLOYMENT TABLES
-- =====================================================

-- Extend pages table for deployment tracking
-- UNCOMMENT if you have a pages table:

-- ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' 
--     CHECK (status IN ('draft', 'preview', 'deployed'));
-- ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS cloudflare_project TEXT;
-- ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS cloudflare_url TEXT;
-- ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ;
-- ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS gads_config JSONB DEFAULT '{}';

-- Track deployment history
CREATE TABLE public.page_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    page_id UUID, -- REFERENCES public.pages(id) if you have pages table
    environment TEXT CHECK (environment IN ('preview', 'production')),
    cloudflare_deployment_id TEXT,
    html_hash TEXT,
    deployed_at TIMESTAMPTZ DEFAULT now(),
    deployed_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_page_deployments_tenant ON public.page_deployments(tenant_id);
CREATE INDEX idx_page_deployments_page ON public.page_deployments(page_id);

ALTER TABLE public.page_deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.page_deployments
    FOR ALL USING (tenant_id = public.get_current_tenant_id());
