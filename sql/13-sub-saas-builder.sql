-- =====================================================
-- SUB-SAAS BUILDER TABLES
-- Enables tenants to create their own SaaS apps (B2B2C)
-- =====================================================

-- 1. Sub-SaaS applications table
CREATE TABLE IF NOT EXISTS public.sub_saas_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    template TEXT DEFAULT 'blank' CHECK (template IN ('blank', 'crm', 'booking', 'ecommerce', 'helpdesk', 'membership')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
    
    -- Stripe Connect for sub-SaaS payments
    stripe_connect_account_id TEXT,
    stripe_connect_enabled BOOLEAN DEFAULT false,
    stripe_connect_onboarded BOOLEAN DEFAULT false,
    
    -- Custom domain
    custom_domain TEXT,
    domain_verified BOOLEAN DEFAULT false,
    
    -- Settings
    settings JSONB DEFAULT '{}',
    branding JSONB DEFAULT '{"primary_color": "#3B82F6", "logo_url": null}',
    features JSONB DEFAULT '[]',
    
    -- Metrics
    user_count INTEGER DEFAULT 0,
    monthly_revenue DECIMAL(10,2) DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id, slug)
);

-- 2. Sub-SaaS users (users within a sub-SaaS app)
CREATE TABLE IF NOT EXISTS public.sub_saas_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE,
    
    -- Can link to main auth.users OR be standalone
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- User details (for standalone users)
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    
    -- Role within the sub-SaaS
    role TEXT DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user', 'guest')),
    
    -- Subscription/payment status within sub-SaaS
    subscription_status TEXT DEFAULT 'free' CHECK (subscription_status IN ('free', 'trial', 'active', 'cancelled', 'past_due')),
    stripe_customer_id TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    last_login_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(sub_saas_id, email)
);

-- 3. Sub-SaaS data tables (dynamic schema)
CREATE TABLE IF NOT EXISTS public.sub_saas_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    schema_definition JSONB NOT NULL, -- Column definitions
    indexes JSONB DEFAULT '[]',
    rls_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(sub_saas_id, table_name)
);

-- 4. Sub-SaaS data (generic JSON storage for dynamic tables)
CREATE TABLE IF NOT EXISTS public.sub_saas_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    user_id UUID REFERENCES public.sub_saas_users(id) ON DELETE SET NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Sub-SaaS payments (Stripe Connect transactions)
CREATE TABLE IF NOT EXISTS public.sub_saas_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_saas_id UUID NOT NULL REFERENCES public.sub_saas_apps(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.sub_saas_users(id) ON DELETE SET NULL,
    
    -- Stripe details
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_checkout_session_id TEXT,
    
    amount DECIMAL(10,2) NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
    
    -- Platform fee (your cut)
    platform_fee DECIMAL(10,2) DEFAULT 0,
    net_amount DECIMAL(10,2),
    
    description TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Sub-SaaS templates (pre-built configurations)
CREATE TABLE IF NOT EXISTS public.sub_saas_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    category TEXT,
    
    -- Template definition
    tables JSONB DEFAULT '[]', -- Table schemas to create
    functions JSONB DEFAULT '[]', -- Edge functions to deploy
    settings JSONB DEFAULT '{}',
    branding JSONB DEFAULT '{}',
    
    -- Marketplace
    is_public BOOLEAN DEFAULT false,
    author_tenant_id UUID REFERENCES public.tenants(id),
    price DECIMAL(10,2) DEFAULT 0, -- 0 = free
    installs INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_sub_saas_apps_tenant ON public.sub_saas_apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sub_saas_apps_slug ON public.sub_saas_apps(slug);
CREATE INDEX IF NOT EXISTS idx_sub_saas_apps_status ON public.sub_saas_apps(status);
CREATE INDEX IF NOT EXISTS idx_sub_saas_users_sub_saas ON public.sub_saas_users(sub_saas_id);
CREATE INDEX IF NOT EXISTS idx_sub_saas_users_email ON public.sub_saas_users(email);
CREATE INDEX IF NOT EXISTS idx_sub_saas_data_sub_saas ON public.sub_saas_data(sub_saas_id);
CREATE INDEX IF NOT EXISTS idx_sub_saas_data_table ON public.sub_saas_data(sub_saas_id, table_name);
CREATE INDEX IF NOT EXISTS idx_sub_saas_payments_sub_saas ON public.sub_saas_payments(sub_saas_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.sub_saas_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_saas_templates ENABLE ROW LEVEL SECURITY;

-- Sub-SaaS apps: tenant owners can manage their apps
CREATE POLICY "Tenant owners can manage sub-saas apps"
    ON public.sub_saas_apps
    FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.user_tenants 
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

-- Sub-SaaS users: app owners can manage users
CREATE POLICY "Sub-saas owners can manage users"
    ON public.sub_saas_users
    FOR ALL
    USING (
        sub_saas_id IN (
            SELECT id FROM public.sub_saas_apps 
            WHERE tenant_id IN (
                SELECT tenant_id FROM public.user_tenants 
                WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
            )
        )
    );

-- Sub-SaaS data: scoped to sub-saas and optionally user
CREATE POLICY "Sub-saas data access"
    ON public.sub_saas_data
    FOR ALL
    USING (
        sub_saas_id IN (
            SELECT id FROM public.sub_saas_apps 
            WHERE tenant_id IN (
                SELECT tenant_id FROM public.user_tenants 
                WHERE user_id = auth.uid()
            )
        )
    );

-- Templates: public templates readable by all
CREATE POLICY "Public templates readable"
    ON public.sub_saas_templates
    FOR SELECT
    USING (is_public = true OR author_tenant_id IN (
        SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    ));

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Get sub-SaaS app by slug
CREATE OR REPLACE FUNCTION public.get_sub_saas_by_slug(app_slug TEXT)
RETURNS public.sub_saas_apps
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT * FROM public.sub_saas_apps 
    WHERE slug = app_slug AND status = 'active'
    LIMIT 1;
$$;

-- Check if user owns a sub-SaaS
CREATE OR REPLACE FUNCTION public.user_owns_sub_saas(app_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.sub_saas_apps s
        JOIN public.user_tenants ut ON s.tenant_id = ut.tenant_id
        WHERE s.id = app_id 
        AND ut.user_id = auth.uid() 
        AND ut.role IN ('owner', 'admin')
    );
$$;

-- Update sub-SaaS metrics
CREATE OR REPLACE FUNCTION public.update_sub_saas_metrics(app_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.sub_saas_apps
    SET 
        user_count = (SELECT COUNT(*) FROM public.sub_saas_users WHERE sub_saas_id = app_id),
        monthly_revenue = (
            SELECT COALESCE(SUM(amount), 0) 
            FROM public.sub_saas_payments 
            WHERE sub_saas_id = app_id 
            AND status = 'succeeded'
            AND created_at >= date_trunc('month', now())
        ),
        updated_at = now()
    WHERE id = app_id;
END;
$$;

-- =====================================================
-- INSERT DEFAULT TEMPLATES
-- =====================================================

INSERT INTO public.sub_saas_templates (name, description, category, tables, settings, is_public) VALUES
('blank', 'Empty starter template', 'starter', '[]', '{}', true),
('crm', 'Customer Relationship Management', 'business', 
 '[{"name": "contacts", "columns": ["name", "email", "phone", "company", "status", "notes"]}, {"name": "deals", "columns": ["title", "value", "stage", "contact_id", "close_date"]}, {"name": "activities", "columns": ["type", "description", "contact_id", "deal_id", "due_date"]}]',
 '{"features": ["contacts", "deals", "pipeline", "activities"]}', true),
('booking', 'Appointment Booking System', 'scheduling',
 '[{"name": "services", "columns": ["name", "description", "duration", "price"]}, {"name": "availability", "columns": ["day_of_week", "start_time", "end_time"]}, {"name": "bookings", "columns": ["service_id", "customer_name", "customer_email", "date", "time", "status"]}]',
 '{"features": ["calendar", "services", "bookings", "reminders"]}', true),
('ecommerce', 'Online Store', 'commerce',
 '[{"name": "products", "columns": ["name", "description", "price", "inventory", "images", "category"]}, {"name": "orders", "columns": ["customer_id", "items", "total", "status", "shipping_address"]}, {"name": "customers", "columns": ["email", "name", "address", "orders_count"]}]',
 '{"features": ["products", "cart", "checkout", "orders"]}', true),
('helpdesk', 'Customer Support Ticketing', 'support',
 '[{"name": "tickets", "columns": ["subject", "description", "status", "priority", "customer_email", "assigned_to"]}, {"name": "replies", "columns": ["ticket_id", "message", "is_internal", "author"]}, {"name": "knowledge_base", "columns": ["title", "content", "category", "is_public"]}]',
 '{"features": ["tickets", "knowledge_base", "canned_responses"]}', true),
('membership', 'Membership & Subscription Site', 'community',
 '[{"name": "plans", "columns": ["name", "description", "price", "interval", "features"]}, {"name": "members", "columns": ["user_id", "plan_id", "status", "started_at", "expires_at"]}, {"name": "content", "columns": ["title", "body", "access_level", "published_at"]}]',
 '{"features": ["plans", "gated_content", "member_directory"]}', true)
ON CONFLICT (name) DO NOTHING;
