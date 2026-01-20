-- =====================================================
-- USAGE TRACKING AND PLAN LIMITS
-- =====================================================

-- 1. Plan limits configuration
CREATE TABLE public.plan_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan TEXT NOT NULL,
    feature TEXT NOT NULL,
    limit_value INTEGER NOT NULL,
    period TEXT DEFAULT 'month',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(plan, feature)
);

-- 2. Usage records
CREATE TABLE public.usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    value INTEGER DEFAULT 0,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, feature, period_start)
);

-- 3. Usage events
CREATE TABLE public.usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    feature TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Add usage tracking to tenants
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS usage_reset_at TIMESTAMPTZ DEFAULT date_trunc('month', now());
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS usage_alerts_sent JSONB DEFAULT '{}';

-- Indexes
CREATE INDEX idx_plan_limits_plan ON public.plan_limits(plan);
CREATE INDEX idx_usage_records_tenant ON public.usage_records(tenant_id);
CREATE INDEX idx_usage_records_period ON public.usage_records(period_start, period_end);
CREATE INDEX idx_usage_events_tenant ON public.usage_events(tenant_id);
CREATE INDEX idx_usage_events_created ON public.usage_events(created_at DESC);

-- RLS
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view plan limits" ON public.plan_limits
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Tenant isolation" ON public.usage_records
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "System insert" ON public.usage_records
    FOR INSERT WITH CHECK (true);

CREATE POLICY "System update" ON public.usage_records
    FOR UPDATE USING (true);

CREATE POLICY "Tenant isolation" ON public.usage_events
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "System insert" ON public.usage_events
    FOR INSERT WITH CHECK (true);

-- SEED: Default plan limits
INSERT INTO public.plan_limits (plan, feature, limit_value, period) VALUES
('free', 'pages', 3, 'total'),
('free', 'deployments', 10, 'month'),
('free', 'team_members', 1, 'total'),
('free', 'api_calls', 100, 'month'),
('free', 'storage_mb', 100, 'total'),
('free', 'custom_domains', 0, 'total'),
('starter', 'pages', 10, 'total'),
('starter', 'deployments', 100, 'month'),
('starter', 'team_members', 3, 'total'),
('starter', 'api_calls', 1000, 'month'),
('starter', 'storage_mb', 1000, 'total'),
('starter', 'custom_domains', 1, 'total'),
('pro', 'pages', 50, 'total'),
('pro', 'deployments', 500, 'month'),
('pro', 'team_members', 10, 'total'),
('pro', 'api_calls', 10000, 'month'),
('pro', 'storage_mb', 10000, 'total'),
('pro', 'custom_domains', 5, 'total'),
('enterprise', 'pages', -1, 'total'),
('enterprise', 'deployments', -1, 'month'),
('enterprise', 'team_members', -1, 'total'),
('enterprise', 'api_calls', -1, 'month'),
('enterprise', 'storage_mb', -1, 'total'),
('enterprise', 'custom_domains', -1, 'total')
ON CONFLICT (plan, feature) DO UPDATE SET
    limit_value = EXCLUDED.limit_value,
    period = EXCLUDED.period,
    updated_at = now();
