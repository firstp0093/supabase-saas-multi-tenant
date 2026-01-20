-- =====================================================
-- STEP 4: GOOGLE ADS ANALYTICS TABLE
-- =====================================================

CREATE TABLE public.gads_impressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    page_id UUID,
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
    FOR ALL USING (tenant_id = public.get_current_tenant_id());
