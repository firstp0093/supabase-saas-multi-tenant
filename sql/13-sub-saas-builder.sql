-- =====================================================
-- SUB-SAAS BUILDER TABLES
-- Enables tenants to create their own SaaS applications
-- B2B2C model: Your platform → Tenants → Their customers
-- =====================================================

-- 1. Sub-SaaS Applications (apps created by your tenants)
CREATE TABLE public.sub_saas_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    
    -- App identity
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    logo_url TEXT,
    
    -- Template used
    template TEXT DEFAULT 'blank' CHECK (template IN ('blank', 'crm', 'booking', 'ecommerce', 'helpdesk', 'membership')),
    
    -- Domain & branding
    custom_domain TEXT UNIQUE,
    subdomain TEXT UNIQUE, -- e.g., myapp.yourplatform.com
    branding JSONB DEFAULT '{}', -- colors, fonts, etc.
    
    -- Stripe Connect
    stripe_connect_enabled BOOLEAN DEFAULT false,
    stripe_account_id TEXT UNIQUE, -- Connected Stripe account
    stripe_onboarding_complete BOOLEAN DEFAULT false,
    
    -- Settings
    settings JSONB DEFAULT '{}',
    features_enabled JSONB DEFAULT '[]', -- Array of feature flags
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'suspended', 'deleted')),
    
    -- Limits (can be set per sub-saas)
    max_users INTEGER DEFAULT 100,
    max_storage_mb INTEGER DEFAULT 1000,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id, slug)
);

-- 2. Sub-SaaS Users (end users of the sub-apps)
CREATE TABLE public.sub_saas_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE,
    
    -- Can link to auth.users if they also have platform account
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- User info (for users without platform account)
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    
    -- Auth (for sub-saas specific auth)
    password_hash TEXT, -- Only if using sub-saas specific auth
    email_verified BOOLEAN DEFAULT false,
    
    -- Role within the sub-saas
    role TEXT DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'member', 'user', 'guest')),
    
    -- Subscription/payment status (via Stripe Connect)
    stripe_customer_id TEXT, -- Customer in connected account
    subscription_status TEXT DEFAULT 'none' CHECK (subscription_status IN ('none', 'trialing', 'active', 'past_due', 'canceled')),
    subscription_plan TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    last_login_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(sub_saas_id, email)
);

-- 3. Stripe Connect Accounts (detailed tracking)
CREATE TABLE public.stripe_connect_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE UNIQUE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    
    -- Stripe account info
    stripe_account_id TEXT NOT NULL UNIQUE,
    account_type TEXT DEFAULT 'standard' CHECK (account_type IN ('standard', 'express', 'custom')),
    
    -- Onboarding status
    details_submitted BOOLEAN DEFAULT false,
    charges_enabled BOOLEAN DEFAULT false,
    payouts_enabled BOOLEAN DEFAULT false,
    
    -- Business info (from Stripe)
    business_name TEXT,
    business_type TEXT,
    country TEXT,
    default_currency TEXT DEFAULT 'usd',
    
    -- Platform fees
    platform_fee_percent NUMERIC(5,2) DEFAULT 0, -- Your cut
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Sub-SaaS Payments (transactions through connected accounts)
CREATE TABLE public.sub_saas_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE,
    sub_saas_user_id UUID REFERENCES public.sub_saas_users(id) ON DELETE SET NULL,
    
    -- Stripe info
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_charge_id TEXT,
    
    -- Amount
    amount INTEGER NOT NULL, -- In cents
    currency TEXT DEFAULT 'usd',
    platform_fee INTEGER DEFAULT 0, -- Your platform's cut in cents
    
    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
    
    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Sub-SaaS Data Tables (dynamic schema per sub-app)
-- This is a meta-table that tracks custom tables created for each sub-saas
CREATE TABLE public.sub_saas_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE,
    
    table_name TEXT NOT NULL, -- Actual table name in DB
    display_name TEXT NOT NULL, -- Human-friendly name
    schema_definition JSONB NOT NULL, -- Column definitions
    
    -- Settings
    enable_rls BOOLEAN DEFAULT true,
    is_system BOOLEAN DEFAULT false, -- System tables can't be deleted
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(sub_saas_id, table_name)
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_sub_saas_apps_tenant ON public.sub_saas_apps(tenant_id);
CREATE INDEX idx_sub_saas_apps_slug ON public.sub_saas_apps(slug);
CREATE INDEX idx_sub_saas_apps_custom_domain ON public.sub_saas_apps(custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX idx_sub_saas_apps_subdomain ON public.sub_saas_apps(subdomain) WHERE subdomain IS NOT NULL;
CREATE INDEX idx_sub_saas_apps_status ON public.sub_saas_apps(status);

CREATE INDEX idx_sub_saas_users_sub_saas ON public.sub_saas_users(sub_saas_id);
CREATE INDEX idx_sub_saas_users_email ON public.sub_saas_users(email);
CREATE INDEX idx_sub_saas_users_auth ON public.sub_saas_users(auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE INDEX idx_stripe_connect_tenant ON public.stripe_connect_accounts(tenant_id);
CREATE INDEX idx_stripe_connect_account ON public.stripe_connect_accounts(stripe_account_id);

CREATE INDEX idx_sub_saas_payments_sub_saas ON public.sub_saas_payments(sub_saas_id);
CREATE INDEX idx_sub_saas_payments_user ON public.sub_saas_payments(sub_saas_user_id);
CREATE INDEX idx_sub_saas_payments_status ON public.sub_saas_payments(status);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.sub_saas_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_connect_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_tables ENABLE ROW LEVEL SECURITY;

-- Sub-SaaS Apps: Tenant members can view their apps
CREATE POLICY "Tenant members can view sub-saas apps"
    ON public.sub_saas_apps FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
        )
    );

-- Sub-SaaS Apps: Only admins/owners can create/modify
CREATE POLICY "Tenant admins can manage sub-saas apps"
    ON public.sub_saas_apps FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.user_tenants 
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

-- Sub-SaaS Users: Tenant members can view
CREATE POLICY "Tenant members can view sub-saas users"
    ON public.sub_saas_users FOR SELECT
    USING (
        sub_saas_id IN (
            SELECT id FROM public.sub_saas_apps 
            WHERE tenant_id IN (
                SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
            )
        )
    );

-- Sub-SaaS Users: Admins can manage
CREATE POLICY "Tenant admins can manage sub-saas users"
    ON public.sub_saas_users FOR ALL
    USING (
        sub_saas_id IN (
            SELECT id FROM public.sub_saas_apps 
            WHERE tenant_id IN (
                SELECT tenant_id FROM public.user_tenants 
                WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
            )
        )
    );

-- Stripe Connect: Only tenant admins
CREATE POLICY "Tenant admins can manage stripe connect"
    ON public.stripe_connect_accounts FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.user_tenants 
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

-- Payments: Tenant members can view
CREATE POLICY "Tenant members can view payments"
    ON public.sub_saas_payments FOR SELECT
    USING (
        sub_saas_id IN (
            SELECT id FROM public.sub_saas_apps 
            WHERE tenant_id IN (
                SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
            )
        )
    );

-- Sub-SaaS Tables: Tenant admins can manage
CREATE POLICY "Tenant admins can manage sub-saas tables"
    ON public.sub_saas_tables FOR ALL
    USING (
        sub_saas_id IN (
            SELECT id FROM public.sub_saas_apps 
            WHERE tenant_id IN (
                SELECT tenant_id FROM public.user_tenants 
                WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
            )
        )
    );

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Get sub-saas by domain (for routing)
CREATE OR REPLACE FUNCTION public.get_sub_saas_by_domain(domain_name TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT id FROM public.sub_saas_apps 
    WHERE (custom_domain = domain_name OR subdomain = domain_name)
    AND status = 'active'
    LIMIT 1;
$$;

-- Check if user has access to sub-saas
CREATE OR REPLACE FUNCTION public.user_has_sub_saas_access(check_sub_saas_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.sub_saas_apps sa
        JOIN public.user_tenants ut ON sa.tenant_id = ut.tenant_id
        WHERE sa.id = check_sub_saas_id AND ut.user_id = auth.uid()
    );
$$;

-- Get sub-saas user count
CREATE OR REPLACE FUNCTION public.get_sub_saas_user_count(check_sub_saas_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT COUNT(*)::INTEGER FROM public.sub_saas_users 
    WHERE sub_saas_id = check_sub_saas_id;
$$;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_sub_saas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sub_saas_apps_updated_at
    BEFORE UPDATE ON public.sub_saas_apps
    FOR EACH ROW EXECUTE FUNCTION public.update_sub_saas_updated_at();

CREATE TRIGGER update_sub_saas_users_updated_at
    BEFORE UPDATE ON public.sub_saas_users
    FOR EACH ROW EXECUTE FUNCTION public.update_sub_saas_updated_at();

CREATE TRIGGER update_stripe_connect_updated_at
    BEFORE UPDATE ON public.stripe_connect_accounts
    FOR EACH ROW EXECUTE FUNCTION public.update_sub_saas_updated_at();
