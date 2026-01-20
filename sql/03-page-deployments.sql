-- =====================================================
-- STEP 3: PAGE DEPLOYMENT COLUMNS AND TABLES
-- Adds Cloudflare deployment tracking to your pages table
-- =====================================================

-- Add deployment columns to your existing pages table
-- (pages already has: id, name, project_id, status, output_html, input_code, etc.)
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS cloudflare_project TEXT;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS cloudflare_url TEXT;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS gads_config JSONB DEFAULT '{}';

-- Update status check to include deployment states
-- Note: Your pages.status is TEXT with no constraint, so this just documents expected values:
-- 'draft', 'preview', 'deployed', 'error' (plus your existing values)

-- Track deployment history
CREATE TABLE public.page_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    page_id TEXT NOT NULL,  -- Matches your pages.id type (TEXT)
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
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.page_deployments
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.page_deployments
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.page_deployments
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());
