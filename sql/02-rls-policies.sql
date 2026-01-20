-- =====================================================
-- STEP 2: ENABLE RLS AND CREATE POLICIES
-- Customized for your 8 existing tables
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawlers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_embeddings ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- TENANTS POLICIES
-- =====================================================
CREATE POLICY "Users can view their tenants" ON public.tenants
    FOR SELECT USING (public.user_has_tenant_access(id));

CREATE POLICY "Owners can update tenant" ON public.tenants
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.user_tenants 
                WHERE tenant_id = id AND user_id = auth.uid() AND role = 'owner')
    );

CREATE POLICY "Owners can insert tenant" ON public.tenants
    FOR INSERT WITH CHECK (true);  -- Controlled via Edge Function

-- =====================================================
-- USER_TENANTS POLICIES
-- =====================================================
CREATE POLICY "Users see own memberships" ON public.user_tenants
    FOR SELECT USING (user_id = auth.uid() OR public.user_has_tenant_access(tenant_id));

CREATE POLICY "Owners manage memberships" ON public.user_tenants
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.user_tenants ut
                WHERE ut.tenant_id = user_tenants.tenant_id 
                AND ut.user_id = auth.uid() 
                AND ut.role IN ('owner', 'admin'))
    );

-- =====================================================
-- APP TABLE POLICIES (tenant isolation)
-- =====================================================

-- AGENTS
CREATE POLICY "Tenant isolation" ON public.agents
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.agents
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.agents
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.agents
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- WORKFLOWS
CREATE POLICY "Tenant isolation" ON public.workflows
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.workflows
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.workflows
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.workflows
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- CRAWLERS
CREATE POLICY "Tenant isolation" ON public.crawlers
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.crawlers
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.crawlers
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.crawlers
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- DOCUMENTS
CREATE POLICY "Tenant isolation" ON public.documents
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.documents
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.documents
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.documents
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- MCP_SERVERS
CREATE POLICY "Tenant isolation" ON public.mcp_servers
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.mcp_servers
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.mcp_servers
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.mcp_servers
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- SETTINGS
CREATE POLICY "Tenant isolation" ON public.settings
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.settings
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.settings
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.settings
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- PAGES
CREATE POLICY "Tenant isolation" ON public.pages
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.pages
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.pages
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.pages
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- PAGE_EMBEDDINGS
CREATE POLICY "Tenant isolation" ON public.page_embeddings
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.page_embeddings
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.page_embeddings
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.page_embeddings
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());
