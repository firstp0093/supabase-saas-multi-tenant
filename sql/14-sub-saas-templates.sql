-- =====================================================
-- SUB-SAAS TEMPLATES SYSTEM
-- Database-driven templates that AI can query and extend
-- Templates create REAL tables via Edge Functions
-- =====================================================

-- 1. Template definitions table
CREATE TABLE IF NOT EXISTS public.sub_saas_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT, -- emoji or icon name
    category TEXT DEFAULT 'general',
    
    -- Defaults applied to sub-saas apps using this template
    features JSONB DEFAULT '[]', -- Array of feature flags
    default_settings JSONB DEFAULT '{}', -- Default app settings
    default_branding JSONB DEFAULT '{}', -- Default branding
    
    -- Permissions
    is_public BOOLEAN DEFAULT true, -- Available to all tenants
    is_active BOOLEAN DEFAULT true, -- Can be used
    tenant_id UUID REFERENCES public.tenants(id), -- If private, owner tenant
    
    -- Metadata
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Template table schemas (the actual table definitions)
CREATE TABLE IF NOT EXISTS public.template_table_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES public.sub_saas_templates(id) ON DELETE CASCADE,
    
    -- Table info
    table_name TEXT NOT NULL, -- Will be prefixed with ss_{sub_saas_id}_
    display_name TEXT NOT NULL,
    description TEXT,
    
    -- Column definitions as JSONB array
    -- Each column: {name, type, required, unique, default, primary, references}
    columns JSONB NOT NULL DEFAULT '[]',
    
    -- Settings
    enable_rls BOOLEAN DEFAULT true,
    is_system BOOLEAN DEFAULT false, -- System tables can't be deleted by users
    sort_order INTEGER DEFAULT 0, -- For creation order (handle FK dependencies)
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(template_id, table_name)
);

-- =====================================================
-- INSERT DEFAULT TEMPLATES
-- =====================================================

-- CRM Template
INSERT INTO public.sub_saas_templates (name, slug, description, icon, category, features) VALUES
('CRM', 'crm', 'Customer relationship management with contacts, deals, and pipeline', '👥', 'sales', 
 '["contacts", "deals", "pipeline", "activities", "reports"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'contacts', 'Contacts', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "name", "type": "text", "required": true},
  {"name": "email", "type": "text", "required": true},
  {"name": "phone", "type": "text"},
  {"name": "company", "type": "text"},
  {"name": "status", "type": "text", "default": "lead"},
  {"name": "source", "type": "text"},
  {"name": "notes", "type": "text"},
  {"name": "metadata", "type": "jsonb", "default": {}},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 1
FROM public.sub_saas_templates WHERE slug = 'crm'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'deals', 'Deals', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "contact_id", "type": "uuid", "references": "contacts"},
  {"name": "title", "type": "text", "required": true},
  {"name": "value", "type": "numeric"},
  {"name": "currency", "type": "text", "default": "USD"},
  {"name": "stage", "type": "text", "default": "discovery"},
  {"name": "probability", "type": "integer", "default": 0},
  {"name": "expected_close", "type": "date"},
  {"name": "notes", "type": "text"},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 2
FROM public.sub_saas_templates WHERE slug = 'crm'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'activities', 'Activities', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "contact_id", "type": "uuid", "references": "contacts"},
  {"name": "deal_id", "type": "uuid", "references": "deals"},
  {"name": "type", "type": "text", "required": true},
  {"name": "subject", "type": "text", "required": true},
  {"name": "description", "type": "text"},
  {"name": "due_date", "type": "timestamptz"},
  {"name": "completed", "type": "boolean", "default": false},
  {"name": "created_by", "type": "uuid"},
  {"name": "created_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 3
FROM public.sub_saas_templates WHERE slug = 'crm'
ON CONFLICT (template_id, table_name) DO NOTHING;

-- Booking Template
INSERT INTO public.sub_saas_templates (name, slug, description, icon, category, features) VALUES
('Booking System', 'booking', 'Appointment and reservation management', '📅', 'services',
 '["services", "bookings", "calendar", "availability", "reminders", "payments"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'services', 'Services', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "name", "type": "text", "required": true},
  {"name": "description", "type": "text"},
  {"name": "duration_minutes", "type": "integer", "default": 60},
  {"name": "price", "type": "numeric"},
  {"name": "currency", "type": "text", "default": "USD"},
  {"name": "category", "type": "text"},
  {"name": "color", "type": "text", "default": "#3B82F6"},
  {"name": "active", "type": "boolean", "default": true},
  {"name": "created_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 1
FROM public.sub_saas_templates WHERE slug = 'booking'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'availability', 'Availability', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "day_of_week", "type": "integer", "required": true},
  {"name": "start_time", "type": "time", "required": true},
  {"name": "end_time", "type": "time", "required": true},
  {"name": "is_available", "type": "boolean", "default": true}
]'::jsonb, 2
FROM public.sub_saas_templates WHERE slug = 'booking'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'bookings', 'Bookings', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "service_id", "type": "uuid", "required": true, "references": "services"},
  {"name": "customer_name", "type": "text", "required": true},
  {"name": "customer_email", "type": "text", "required": true},
  {"name": "customer_phone", "type": "text"},
  {"name": "start_time", "type": "timestamptz", "required": true},
  {"name": "end_time", "type": "timestamptz", "required": true},
  {"name": "status", "type": "text", "default": "pending"},
  {"name": "notes", "type": "text"},
  {"name": "payment_status", "type": "text", "default": "unpaid"},
  {"name": "payment_amount", "type": "numeric"},
  {"name": "created_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 3
FROM public.sub_saas_templates WHERE slug = 'booking'
ON CONFLICT (template_id, table_name) DO NOTHING;

-- E-commerce Template
INSERT INTO public.sub_saas_templates (name, slug, description, icon, category, features) VALUES
('E-commerce', 'ecommerce', 'Online store with products, orders, and inventory', '🛒', 'commerce',
 '["products", "categories", "orders", "cart", "inventory", "payments", "shipping", "discounts"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'categories', 'Categories', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "name", "type": "text", "required": true},
  {"name": "slug", "type": "text", "required": true},
  {"name": "description", "type": "text"},
  {"name": "parent_id", "type": "uuid"},
  {"name": "image_url", "type": "text"},
  {"name": "sort_order", "type": "integer", "default": 0},
  {"name": "active", "type": "boolean", "default": true}
]'::jsonb, 1
FROM public.sub_saas_templates WHERE slug = 'ecommerce'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'products', 'Products', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "category_id", "type": "uuid", "references": "categories"},
  {"name": "name", "type": "text", "required": true},
  {"name": "slug", "type": "text", "required": true},
  {"name": "description", "type": "text"},
  {"name": "price", "type": "numeric", "required": true},
  {"name": "compare_at_price", "type": "numeric"},
  {"name": "currency", "type": "text", "default": "USD"},
  {"name": "sku", "type": "text"},
  {"name": "barcode", "type": "text"},
  {"name": "inventory_quantity", "type": "integer", "default": 0},
  {"name": "track_inventory", "type": "boolean", "default": true},
  {"name": "images", "type": "jsonb", "default": []},
  {"name": "variants", "type": "jsonb", "default": []},
  {"name": "metadata", "type": "jsonb", "default": {}},
  {"name": "status", "type": "text", "default": "draft"},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 2
FROM public.sub_saas_templates WHERE slug = 'ecommerce'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'orders', 'Orders', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "order_number", "type": "text", "required": true, "unique": true},
  {"name": "customer_email", "type": "text", "required": true},
  {"name": "customer_name", "type": "text"},
  {"name": "customer_phone", "type": "text"},
  {"name": "items", "type": "jsonb", "required": true},
  {"name": "subtotal", "type": "numeric", "required": true},
  {"name": "tax", "type": "numeric", "default": 0},
  {"name": "shipping", "type": "numeric", "default": 0},
  {"name": "discount", "type": "numeric", "default": 0},
  {"name": "total", "type": "numeric", "required": true},
  {"name": "currency", "type": "text", "default": "USD"},
  {"name": "status", "type": "text", "default": "pending"},
  {"name": "payment_status", "type": "text", "default": "unpaid"},
  {"name": "payment_method", "type": "text"},
  {"name": "payment_intent_id", "type": "text"},
  {"name": "shipping_address", "type": "jsonb"},
  {"name": "billing_address", "type": "jsonb"},
  {"name": "notes", "type": "text"},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 3
FROM public.sub_saas_templates WHERE slug = 'ecommerce'
ON CONFLICT (template_id, table_name) DO NOTHING;

-- Helpdesk Template
INSERT INTO public.sub_saas_templates (name, slug, description, icon, category, features) VALUES
('Helpdesk', 'helpdesk', 'Customer support with tickets and knowledge base', '🎫', 'support',
 '["tickets", "messages", "knowledge_base", "canned_responses", "sla", "reports"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'tickets', 'Tickets', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "ticket_number", "type": "text", "required": true, "unique": true},
  {"name": "subject", "type": "text", "required": true},
  {"name": "description", "type": "text", "required": true},
  {"name": "customer_email", "type": "text", "required": true},
  {"name": "customer_name", "type": "text"},
  {"name": "priority", "type": "text", "default": "medium"},
  {"name": "status", "type": "text", "default": "open"},
  {"name": "category", "type": "text"},
  {"name": "tags", "type": "jsonb", "default": []},
  {"name": "assigned_to", "type": "uuid"},
  {"name": "first_response_at", "type": "timestamptz"},
  {"name": "resolved_at", "type": "timestamptz"},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 1
FROM public.sub_saas_templates WHERE slug = 'helpdesk'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'ticket_messages', 'Messages', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "ticket_id", "type": "uuid", "required": true, "references": "tickets"},
  {"name": "message", "type": "text", "required": true},
  {"name": "sender_type", "type": "text", "required": true},
  {"name": "sender_id", "type": "text"},
  {"name": "sender_name", "type": "text"},
  {"name": "attachments", "type": "jsonb", "default": []},
  {"name": "is_internal", "type": "boolean", "default": false},
  {"name": "created_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 2
FROM public.sub_saas_templates WHERE slug = 'helpdesk'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'knowledge_base', 'Knowledge Base', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "title", "type": "text", "required": true},
  {"name": "slug", "type": "text", "required": true},
  {"name": "content", "type": "text", "required": true},
  {"name": "category", "type": "text"},
  {"name": "tags", "type": "jsonb", "default": []},
  {"name": "status", "type": "text", "default": "draft"},
  {"name": "views", "type": "integer", "default": 0},
  {"name": "helpful_yes", "type": "integer", "default": 0},
  {"name": "helpful_no", "type": "integer", "default": 0},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 3
FROM public.sub_saas_templates WHERE slug = 'helpdesk'
ON CONFLICT (template_id, table_name) DO NOTHING;

-- Membership Template
INSERT INTO public.sub_saas_templates (name, slug, description, icon, category, features) VALUES
('Membership', 'membership', 'Subscription-based membership with gated content', '🎟️', 'community',
 '["plans", "members", "content", "payments", "content_gating", "emails"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'membership_plans', 'Plans', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "name", "type": "text", "required": true},
  {"name": "slug", "type": "text", "required": true, "unique": true},
  {"name": "description", "type": "text"},
  {"name": "price_monthly", "type": "numeric"},
  {"name": "price_yearly", "type": "numeric"},
  {"name": "currency", "type": "text", "default": "USD"},
  {"name": "features", "type": "jsonb", "default": []},
  {"name": "access_level", "type": "integer", "default": 1},
  {"name": "stripe_price_monthly_id", "type": "text"},
  {"name": "stripe_price_yearly_id", "type": "text"},
  {"name": "trial_days", "type": "integer", "default": 0},
  {"name": "active", "type": "boolean", "default": true},
  {"name": "sort_order", "type": "integer", "default": 0},
  {"name": "created_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 1
FROM public.sub_saas_templates WHERE slug = 'membership'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'members', 'Members', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "plan_id", "type": "uuid", "references": "membership_plans"},
  {"name": "email", "type": "text", "required": true},
  {"name": "name", "type": "text"},
  {"name": "avatar_url", "type": "text"},
  {"name": "status", "type": "text", "default": "active"},
  {"name": "stripe_customer_id", "type": "text"},
  {"name": "stripe_subscription_id", "type": "text"},
  {"name": "current_period_start", "type": "timestamptz"},
  {"name": "current_period_end", "type": "timestamptz"},
  {"name": "cancelled_at", "type": "timestamptz"},
  {"name": "metadata", "type": "jsonb", "default": {}},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 2
FROM public.sub_saas_templates WHERE slug = 'membership'
ON CONFLICT (template_id, table_name) DO NOTHING;

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, columns, sort_order)
SELECT id, 'content', 'Content', '[
  {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
  {"name": "title", "type": "text", "required": true},
  {"name": "slug", "type": "text", "required": true},
  {"name": "type", "type": "text", "default": "article"},
  {"name": "content", "type": "text"},
  {"name": "excerpt", "type": "text"},
  {"name": "thumbnail_url", "type": "text"},
  {"name": "media_url", "type": "text"},
  {"name": "access_level", "type": "integer", "default": 0},
  {"name": "status", "type": "text", "default": "draft"},
  {"name": "published_at", "type": "timestamptz"},
  {"name": "metadata", "type": "jsonb", "default": {}},
  {"name": "created_at", "type": "timestamptz", "default": "now()"},
  {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]'::jsonb, 3
FROM public.sub_saas_templates WHERE slug = 'membership'
ON CONFLICT (template_id, table_name) DO NOTHING;

-- Blank Template (no tables)
INSERT INTO public.sub_saas_templates (name, slug, description, icon, category, features) VALUES
('Blank', 'blank', 'Start from scratch - AI will build your tables', '📝', 'general', '[]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_sub_saas_templates_slug ON public.sub_saas_templates(slug);
CREATE INDEX IF NOT EXISTS idx_sub_saas_templates_category ON public.sub_saas_templates(category);
CREATE INDEX IF NOT EXISTS idx_sub_saas_templates_public ON public.sub_saas_templates(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_template_schemas_template ON public.template_table_schemas(template_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.sub_saas_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_table_schemas ENABLE ROW LEVEL SECURITY;

-- Public templates visible to all authenticated users
CREATE POLICY "Public templates visible to all" ON public.sub_saas_templates 
    FOR SELECT USING (
        is_public = true OR 
        tenant_id IN (SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid())
    );

-- Template schemas follow their parent template's visibility
CREATE POLICY "Template schemas follow template visibility" ON public.template_table_schemas
    FOR SELECT USING (
        template_id IN (
            SELECT id FROM public.sub_saas_templates 
            WHERE is_public = true OR 
                  tenant_id IN (SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid())
        )
    );

-- =====================================================
-- HELPER FUNCTION: Execute SQL (for table creation)
-- =====================================================

CREATE OR REPLACE FUNCTION public.exec_sql(sql TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    EXECUTE sql;
END;
$$;

-- Restrict to service role only
REVOKE ALL ON FUNCTION public.exec_sql(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_sql(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.exec_sql(TEXT) FROM anon;
-- Service role has access by default as SECURITY DEFINER
