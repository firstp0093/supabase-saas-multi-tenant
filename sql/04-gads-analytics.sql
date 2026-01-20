-- =====================================================
-- STEP 4: GOOGLE ADS ANALYTICS TABLE
-- Tracks impressions and keyword matches
-- =====================================================

CREATE TABLE public.gads_impressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    page_id TEXT,  -- Matches your pages.id type (TEXT)
    gclid TEXT,
    keyword TEXT,
    url TEXT,
    matched_config BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gads_impressions_tenant ON public.gads_impressions(tenant_id);
CREATE INDEX idx_gads_impressions_page ON public.gads_impressions(page_id);
CREATE INDEX idx_gads_impressions_keyword ON public.gads_impressions(keyword);
CREATE INDEX idx_gads_impressions_created ON public.gads_impressions(created_at);

ALTER TABLE public.gads_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.gads_impressions
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant insert" ON public.gads_impressions
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant update" ON public.gads_impressions
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant delete" ON public.gads_impressions
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());
