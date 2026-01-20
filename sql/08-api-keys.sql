-- =====================================================
-- API KEYS SYSTEM
-- =====================================================

CREATE TABLE public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    scopes JSONB DEFAULT '["read"]',
    last_used_at TIMESTAMPTZ,
    last_used_ip TEXT,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES auth.users(id)
);

CREATE TABLE public.api_request_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_api_keys_tenant ON public.api_keys(tenant_id);
CREATE INDEX idx_api_keys_prefix ON public.api_keys(key_prefix);
CREATE INDEX idx_api_keys_hash ON public.api_keys(key_hash);
CREATE INDEX idx_api_keys_active ON public.api_keys(is_active) WHERE is_active = true;
CREATE INDEX idx_api_request_log_tenant ON public.api_request_log(tenant_id);
CREATE INDEX idx_api_request_log_key ON public.api_request_log(api_key_id);
CREATE INDEX idx_api_request_log_created ON public.api_request_log(created_at DESC);

-- RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view keys" ON public.api_keys
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Admins can manage keys" ON public.api_keys
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_tenants
            WHERE tenant_id = api_keys.tenant_id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
    );

CREATE POLICY "Tenant isolation" ON public.api_request_log
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "System insert" ON public.api_request_log
    FOR INSERT WITH CHECK (true);
