-- =====================================================
-- STEP 2: ENABLE RLS AND CREATE POLICIES
-- =====================================================

-- Enable RLS on core tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenants ENABLE ROW LEVEL SECURITY;

-- UNCOMMENT for tables you have:
-- ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.crawlers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.page_embeddings ENABLE ROW LEVEL SECURITY;

-- Tenants: users can only see tenants they belong to
CREATE POLICY "Users can view their tenants" ON public.tenants
    FOR SELECT USING (public.user_has_tenant_access(id));

CREATE POLICY "Owners can update tenant" ON public.tenants
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.user_tenants 
                WHERE tenant_id = id AND user_id = auth.uid() AND role = 'owner')
    );

-- User_tenants: users see their own memberships, owners manage all
CREATE POLICY "Users see own memberships" ON public.user_tenants
    FOR SELECT USING (user_id = auth.uid() OR public.user_has_tenant_access(tenant_id));

CREATE POLICY "Owners manage memberships" ON public.user_tenants
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.user_tenants ut
                WHERE ut.tenant_id = user_tenants.tenant_id 
                AND ut.user_id = auth.uid() 
                AND ut.role IN ('owner', 'admin'))
    );

-- UNCOMMENT policies for tables you have:

-- CREATE POLICY "Tenant isolation" ON public.agents
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());

-- CREATE POLICY "Tenant isolation" ON public.workflows
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());

-- CREATE POLICY "Tenant isolation" ON public.crawlers
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());

-- CREATE POLICY "Tenant isolation" ON public.documents
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());

-- CREATE POLICY "Tenant isolation" ON public.mcp_servers
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());

-- CREATE POLICY "Tenant isolation" ON public.settings
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());

-- CREATE POLICY "Tenant isolation" ON public.pages
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());

-- CREATE POLICY "Tenant isolation" ON public.page_embeddings
--     FOR ALL USING (tenant_id = public.get_current_tenant_id());
