-- =====================================================
-- STEP 1: CREATE TENANTS AND USER_TENANTS TABLES
-- Customized for your existing schema
-- =====================================================

-- 1. Create tenants table (links to Stripe customer)
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create user-tenant junction (supports multi-tenant per user)
CREATE TABLE public.user_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, tenant_id)
);

-- 3. Add tenant_id to ALL your existing tables
ALTER TABLE public.agents ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.workflows ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.crawlers ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.documents ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.mcp_servers ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.settings ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.pages ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.page_embeddings ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);

-- 4. Create indexes for tenant lookups (improves query performance)
CREATE INDEX idx_user_tenants_user ON public.user_tenants(user_id);
CREATE INDEX idx_user_tenants_tenant ON public.user_tenants(tenant_id);
CREATE INDEX idx_agents_tenant ON public.agents(tenant_id);
CREATE INDEX idx_workflows_tenant ON public.workflows(tenant_id);
CREATE INDEX idx_crawlers_tenant ON public.crawlers(tenant_id);
CREATE INDEX idx_documents_tenant ON public.documents(tenant_id);
CREATE INDEX idx_mcp_servers_tenant ON public.mcp_servers(tenant_id);
CREATE INDEX idx_settings_tenant ON public.settings(tenant_id);
CREATE INDEX idx_pages_tenant ON public.pages(tenant_id);
CREATE INDEX idx_page_embeddings_tenant ON public.page_embeddings(tenant_id);

-- 5. Helper function: Get user's current tenant from JWT or default
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- First try JWT claim
    _tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
    
    -- Fall back to user's default tenant
    IF _tenant_id IS NULL THEN
        SELECT tenant_id INTO _tenant_id
        FROM public.user_tenants
        WHERE user_id = auth.uid() AND is_default = true
        LIMIT 1;
    END IF;
    
    -- Fall back to any tenant user belongs to
    IF _tenant_id IS NULL THEN
        SELECT tenant_id INTO _tenant_id
        FROM public.user_tenants
        WHERE user_id = auth.uid()
        LIMIT 1;
    END IF;
    
    RETURN _tenant_id;
END;
$$;

-- 6. Helper: Check if user has access to tenant
CREATE OR REPLACE FUNCTION public.user_has_tenant_access(check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_tenants
        WHERE user_id = auth.uid() AND tenant_id = check_tenant_id
    );
$$;
