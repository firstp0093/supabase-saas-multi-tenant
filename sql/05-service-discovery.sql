-- =====================================================
-- SERVICE DISCOVERY SYSTEM
-- Lets your SaaS frontend discover available services
-- and their configuration status
-- =====================================================

-- 1. Available services catalog (platform-wide)
CREATE TABLE public.services (
    id TEXT PRIMARY KEY,                    -- e.g., 'stripe', 'cloudflare', 'gads', 'auth'
    name TEXT NOT NULL,                     -- Display name: 'Stripe Payments'
    description TEXT,                       -- What this service does
    category TEXT NOT NULL,                 -- 'payments', 'hosting', 'analytics', 'auth', 'storage'
    is_core BOOLEAN DEFAULT false,          -- Core services can't be disabled
    is_enabled BOOLEAN DEFAULT true,        -- Platform-wide toggle
    config_schema JSONB DEFAULT '{}',       -- JSON Schema for required config
    docs_url TEXT,                          -- Link to documentation
    icon TEXT,                              -- Icon name or URL
    sort_order INTEGER DEFAULT 0,           -- Display order
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Service health/status (platform-wide, updated by health checks)
CREATE TABLE public.service_status (
    service_id TEXT PRIMARY KEY REFERENCES public.services(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'down', 'unknown')),
    last_check_at TIMESTAMPTZ,
    last_healthy_at TIMESTAMPTZ,
    error_message TEXT,
    response_time_ms INTEGER,
    metadata JSONB DEFAULT '{}',            -- Additional status info
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tenant-specific service configuration
CREATE TABLE public.tenant_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT true,        -- Tenant can disable optional services
    is_configured BOOLEAN DEFAULT false,    -- Has tenant completed setup?
    config JSONB DEFAULT '{}',              -- Tenant-specific config (non-sensitive)
    credentials_set BOOLEAN DEFAULT false,  -- Are secrets configured? (don't store secrets here)
    last_used_at TIMESTAMPTZ,
    usage_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, service_id)
);

-- 4. Service dependencies (which services require others)
CREATE TABLE public.service_dependencies (
    service_id TEXT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT true,       -- Hard vs soft dependency
    PRIMARY KEY (service_id, depends_on)
);

-- 5. Service changelog (track when services change)
CREATE TABLE public.service_changelog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id TEXT REFERENCES public.services(id) ON DELETE SET NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('added', 'updated', 'deprecated', 'removed', 'status_change')),
    title TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_services_category ON public.services(category);
CREATE INDEX idx_services_enabled ON public.services(is_enabled);
CREATE INDEX idx_tenant_services_tenant ON public.tenant_services(tenant_id);
CREATE INDEX idx_tenant_services_service ON public.tenant_services(service_id);
CREATE INDEX idx_service_changelog_service ON public.service_changelog(service_id);
CREATE INDEX idx_service_changelog_created ON public.service_changelog(created_at DESC);

-- RLS Policies
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_changelog ENABLE ROW LEVEL SECURITY;

-- Services catalog is readable by all authenticated users
CREATE POLICY "Authenticated users can view services" ON public.services
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view service status" ON public.service_status
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view dependencies" ON public.service_dependencies
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view changelog" ON public.service_changelog
    FOR SELECT USING (auth.role() = 'authenticated');

-- Tenant services: tenant isolation
CREATE POLICY "Tenant isolation select" ON public.tenant_services
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant isolation insert" ON public.tenant_services
    FOR INSERT WITH CHECK (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant isolation update" ON public.tenant_services
    FOR UPDATE USING (tenant_id = public.get_current_tenant_id());
CREATE POLICY "Tenant isolation delete" ON public.tenant_services
    FOR DELETE USING (tenant_id = public.get_current_tenant_id());

-- =====================================================
-- SEED DATA: Your available services
-- =====================================================

INSERT INTO public.services (id, name, description, category, is_core, is_enabled, config_schema, docs_url, icon, sort_order) VALUES
-- Core Services (always available)
('supabase_auth', 'Supabase Auth', 'User authentication and session management', 'auth', true, true, 
 '{"type": "object", "properties": {"providers": {"type": "array", "items": {"type": "string"}}}}',
 'https://supabase.com/docs/guides/auth', 'lock', 1),

('supabase_db', 'Supabase Database', 'PostgreSQL database with RLS', 'storage', true, true,
 '{"type": "object", "properties": {}}',
 'https://supabase.com/docs/guides/database', 'database', 2),

-- Payment Services
('stripe', 'Stripe Payments', 'Accept payments and manage subscriptions', 'payments', false, true,
 '{"type": "object", "required": ["publishable_key"], "properties": {"publishable_key": {"type": "string"}, "webhook_configured": {"type": "boolean"}}}',
 'https://stripe.com/docs', 'credit-card', 10),

('stripe_checkout', 'Stripe Checkout', 'Hosted checkout pages for payments', 'payments', false, true,
 '{"type": "object", "properties": {"success_url": {"type": "string"}, "cancel_url": {"type": "string"}}}',
 'https://stripe.com/docs/checkout', 'shopping-cart', 11),

('stripe_portal', 'Customer Portal', 'Self-service subscription management', 'payments', false, true,
 '{"type": "object", "properties": {"return_url": {"type": "string"}}}',
 'https://stripe.com/docs/billing/subscriptions/customer-portal', 'user-cog', 12),

-- Hosting/Deployment Services
('cloudflare_pages', 'Cloudflare Pages', 'Deploy static pages globally', 'hosting', false, true,
 '{"type": "object", "required": ["account_id"], "properties": {"account_id": {"type": "string"}, "default_project": {"type": "string"}}}',
 'https://developers.cloudflare.com/pages', 'cloud', 20),

('cloudflare_domains', 'Custom Domains', 'Connect custom domains to your pages', 'hosting', false, true,
 '{"type": "object", "properties": {"verified_domains": {"type": "array", "items": {"type": "string"}}}}',
 'https://developers.cloudflare.com/pages/platform/custom-domains', 'globe', 21),

-- Analytics Services
('gads_matching', 'Google Ads Message Matching', 'Dynamic content based on ad keywords', 'analytics', false, true,
 '{"type": "object", "properties": {"default_config": {"type": "object"}}}',
 NULL, 'target', 30),

('page_analytics', 'Page Analytics', 'Track page views and conversions', 'analytics', false, true,
 '{"type": "object", "properties": {"track_views": {"type": "boolean"}, "track_conversions": {"type": "boolean"}}}',
 NULL, 'bar-chart', 31),

-- Storage Services
('supabase_storage', 'File Storage', 'Upload and manage files', 'storage', false, true,
 '{"type": "object", "properties": {"max_file_size_mb": {"type": "integer"}, "allowed_types": {"type": "array"}}}',
 'https://supabase.com/docs/guides/storage', 'folder', 40),

-- AI Services
('openai', 'OpenAI', 'AI text generation and embeddings', 'ai', false, true,
 '{"type": "object", "properties": {"model": {"type": "string"}, "max_tokens": {"type": "integer"}}}',
 'https://platform.openai.com/docs', 'brain', 50),

('anthropic', 'Anthropic Claude', 'AI assistant capabilities', 'ai', false, true,
 '{"type": "object", "properties": {"model": {"type": "string"}}}',
 'https://docs.anthropic.com', 'message-circle', 51),

-- Communication Services
('email_resend', 'Resend Email', 'Transactional email delivery', 'communication', false, true,
 '{"type": "object", "properties": {"from_email": {"type": "string"}, "from_name": {"type": "string"}}}',
 'https://resend.com/docs', 'mail', 60),

('email_sendgrid', 'SendGrid Email', 'Transactional email delivery', 'communication', false, true,
 '{"type": "object", "properties": {"from_email": {"type": "string"}, "from_name": {"type": "string"}}}',
 'https://docs.sendgrid.com', 'mail', 61)

ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    config_schema = EXCLUDED.config_schema,
    docs_url = EXCLUDED.docs_url,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

-- Service dependencies
INSERT INTO public.service_dependencies (service_id, depends_on, is_required) VALUES
('stripe_checkout', 'stripe', true),
('stripe_portal', 'stripe', true),
('cloudflare_domains', 'cloudflare_pages', true),
('gads_matching', 'cloudflare_pages', false),
('page_analytics', 'supabase_db', true)
ON CONFLICT DO NOTHING;

-- Initialize service status
INSERT INTO public.service_status (service_id, status, last_check_at)
SELECT id, 'unknown', now() FROM public.services
ON CONFLICT DO NOTHING;

-- Log initial setup
INSERT INTO public.service_changelog (service_id, change_type, title, description)
SELECT id, 'added', 'Service added', 'Initial service catalog setup'
FROM public.services
ON CONFLICT DO NOTHING;
