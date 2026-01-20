-- =====================================================
-- SUB-SAAS TEMPLATES SYSTEM
-- Database-driven templates that AI can query and extend
-- Templates create REAL tables, not just metadata
-- =====================================================

-- 1. Template definitions table
CREATE TABLE public.sub_saas_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT, -- emoji or icon name
    category TEXT DEFAULT 'general',
    
    -- Template content
    tables JSONB NOT NULL DEFAULT '[]', -- Array of table definitions
    features JSONB NOT NULL DEFAULT '[]', -- Array of feature flags
    default_settings JSONB DEFAULT '{}', -- Default app settings
    default_branding JSONB DEFAULT '{}', -- Default branding
    
    -- Permissions
    is_public BOOLEAN DEFAULT true, -- Available to all tenants
    tenant_id UUID REFERENCES public.tenants(id), -- If private, owner tenant
    
    -- Metadata
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Insert default templates
INSERT INTO public.sub_saas_templates (name, slug, description, icon, category, tables, features) VALUES

-- CRM Template
('CRM', 'crm', 'Customer relationship management with contacts, deals, and pipeline', '👥', 'sales', 
'[
  {
    "name": "contacts",
    "display_name": "Contacts",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "name", "type": "TEXT", "required": true},
      {"name": "email", "type": "TEXT", "required": true},
      {"name": "phone", "type": "TEXT"},
      {"name": "company", "type": "TEXT"},
      {"name": "status", "type": "TEXT", "default": "lead", "check": "status IN (''lead'', ''prospect'', ''customer'', ''churned'')"},
      {"name": "source", "type": "TEXT"},
      {"name": "notes", "type": "TEXT"},
      {"name": "metadata", "type": "JSONB", "default": "''{}''"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "email", "status"]
  },
  {
    "name": "deals",
    "display_name": "Deals",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "contact_id", "type": "UUID", "foreign_key": "contacts.id"},
      {"name": "title", "type": "TEXT", "required": true},
      {"name": "value", "type": "NUMERIC(12,2)"},
      {"name": "currency", "type": "TEXT", "default": "''USD''"},
      {"name": "stage", "type": "TEXT", "default": "discovery", "check": "stage IN (''discovery'', ''proposal'', ''negotiation'', ''won'', ''lost'')"},
      {"name": "probability", "type": "INTEGER", "default": "0", "check": "probability >= 0 AND probability <= 100"},
      {"name": "expected_close", "type": "DATE"},
      {"name": "notes", "type": "TEXT"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "contact_id", "stage"]
  },
  {
    "name": "activities",
    "display_name": "Activities",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "contact_id", "type": "UUID", "foreign_key": "contacts.id"},
      {"name": "deal_id", "type": "UUID", "foreign_key": "deals.id"},
      {"name": "type", "type": "TEXT", "required": true, "check": "type IN (''call'', ''email'', ''meeting'', ''note'', ''task'')"},
      {"name": "subject", "type": "TEXT", "required": true},
      {"name": "description", "type": "TEXT"},
      {"name": "due_date", "type": "TIMESTAMPTZ"},
      {"name": "completed", "type": "BOOLEAN", "default": "false"},
      {"name": "created_by", "type": "UUID"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "contact_id", "deal_id", "type"]
  }
]'::jsonb,
'["contacts", "deals", "pipeline", "activities", "reports"]'::jsonb),

-- Booking Template
('Booking System', 'booking', 'Appointment and reservation management', '📅', 'services',
'[
  {
    "name": "services",
    "display_name": "Services",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "name", "type": "TEXT", "required": true},
      {"name": "description", "type": "TEXT"},
      {"name": "duration_minutes", "type": "INTEGER", "default": "60"},
      {"name": "price", "type": "NUMERIC(10,2)"},
      {"name": "currency", "type": "TEXT", "default": "''USD''"},
      {"name": "category", "type": "TEXT"},
      {"name": "color", "type": "TEXT", "default": "''#3B82F6''"},
      {"name": "active", "type": "BOOLEAN", "default": "true"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "active"]
  },
  {
    "name": "availability",
    "display_name": "Availability",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "day_of_week", "type": "INTEGER", "required": true, "check": "day_of_week >= 0 AND day_of_week <= 6"},
      {"name": "start_time", "type": "TIME", "required": true},
      {"name": "end_time", "type": "TIME", "required": true},
      {"name": "is_available", "type": "BOOLEAN", "default": "true"}
    ],
    "indexes": ["sub_saas_id", "day_of_week"]
  },
  {
    "name": "bookings",
    "display_name": "Bookings",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "service_id", "type": "UUID", "required": true, "foreign_key": "services.id"},
      {"name": "customer_name", "type": "TEXT", "required": true},
      {"name": "customer_email", "type": "TEXT", "required": true},
      {"name": "customer_phone", "type": "TEXT"},
      {"name": "start_time", "type": "TIMESTAMPTZ", "required": true},
      {"name": "end_time", "type": "TIMESTAMPTZ", "required": true},
      {"name": "status", "type": "TEXT", "default": "pending", "check": "status IN (''pending'', ''confirmed'', ''cancelled'', ''completed'', ''no_show'')"},
      {"name": "notes", "type": "TEXT"},
      {"name": "payment_status", "type": "TEXT", "default": "unpaid", "check": "payment_status IN (''unpaid'', ''paid'', ''refunded'')"},
      {"name": "payment_amount", "type": "NUMERIC(10,2)"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "service_id", "start_time", "status"]
  }
]'::jsonb,
'["services", "bookings", "calendar", "availability", "reminders", "payments"]'::jsonb),

-- E-commerce Template
('E-commerce', 'ecommerce', 'Online store with products, orders, and inventory', '🛒', 'commerce',
'[
  {
    "name": "categories",
    "display_name": "Categories",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "name", "type": "TEXT", "required": true},
      {"name": "slug", "type": "TEXT", "required": true},
      {"name": "description", "type": "TEXT"},
      {"name": "parent_id", "type": "UUID"},
      {"name": "image_url", "type": "TEXT"},
      {"name": "sort_order", "type": "INTEGER", "default": "0"},
      {"name": "active", "type": "BOOLEAN", "default": "true"}
    ],
    "indexes": ["sub_saas_id", "slug", "parent_id"]
  },
  {
    "name": "products",
    "display_name": "Products",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "category_id", "type": "UUID", "foreign_key": "categories.id"},
      {"name": "name", "type": "TEXT", "required": true},
      {"name": "slug", "type": "TEXT", "required": true},
      {"name": "description", "type": "TEXT"},
      {"name": "price", "type": "NUMERIC(10,2)", "required": true},
      {"name": "compare_at_price", "type": "NUMERIC(10,2)"},
      {"name": "currency", "type": "TEXT", "default": "''USD''"},
      {"name": "sku", "type": "TEXT"},
      {"name": "barcode", "type": "TEXT"},
      {"name": "inventory_quantity", "type": "INTEGER", "default": "0"},
      {"name": "track_inventory", "type": "BOOLEAN", "default": "true"},
      {"name": "images", "type": "JSONB", "default": "''[]''"},
      {"name": "variants", "type": "JSONB", "default": "''[]''"},
      {"name": "metadata", "type": "JSONB", "default": "''{}''"},
      {"name": "status", "type": "TEXT", "default": "draft", "check": "status IN (''draft'', ''active'', ''archived'')"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "category_id", "slug", "sku", "status"]
  },
  {
    "name": "orders",
    "display_name": "Orders",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "order_number", "type": "TEXT", "required": true},
      {"name": "customer_email", "type": "TEXT", "required": true},
      {"name": "customer_name", "type": "TEXT"},
      {"name": "customer_phone", "type": "TEXT"},
      {"name": "items", "type": "JSONB", "required": true},
      {"name": "subtotal", "type": "NUMERIC(10,2)", "required": true},
      {"name": "tax", "type": "NUMERIC(10,2)", "default": "0"},
      {"name": "shipping", "type": "NUMERIC(10,2)", "default": "0"},
      {"name": "discount", "type": "NUMERIC(10,2)", "default": "0"},
      {"name": "total", "type": "NUMERIC(10,2)", "required": true},
      {"name": "currency", "type": "TEXT", "default": "''USD''"},
      {"name": "status", "type": "TEXT", "default": "pending", "check": "status IN (''pending'', ''processing'', ''shipped'', ''delivered'', ''cancelled'', ''refunded'')"},
      {"name": "payment_status", "type": "TEXT", "default": "unpaid", "check": "payment_status IN (''unpaid'', ''paid'', ''refunded'', ''failed'')"},
      {"name": "payment_method", "type": "TEXT"},
      {"name": "payment_intent_id", "type": "TEXT"},
      {"name": "shipping_address", "type": "JSONB"},
      {"name": "billing_address", "type": "JSONB"},
      {"name": "notes", "type": "TEXT"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "order_number", "customer_email", "status", "payment_status"]
  }
]'::jsonb,
'["products", "categories", "orders", "cart", "inventory", "payments", "shipping", "discounts"]'::jsonb),

-- Helpdesk Template
('Helpdesk', 'helpdesk', 'Customer support with tickets and knowledge base', '🎫', 'support',
'[
  {
    "name": "tickets",
    "display_name": "Tickets",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "ticket_number", "type": "TEXT", "required": true},
      {"name": "subject", "type": "TEXT", "required": true},
      {"name": "description", "type": "TEXT", "required": true},
      {"name": "customer_email", "type": "TEXT", "required": true},
      {"name": "customer_name", "type": "TEXT"},
      {"name": "priority", "type": "TEXT", "default": "medium", "check": "priority IN (''low'', ''medium'', ''high'', ''urgent'')"},
      {"name": "status", "type": "TEXT", "default": "open", "check": "status IN (''open'', ''pending'', ''in_progress'', ''resolved'', ''closed'')"},
      {"name": "category", "type": "TEXT"},
      {"name": "tags", "type": "JSONB", "default": "''[]''"},
      {"name": "assigned_to", "type": "UUID"},
      {"name": "first_response_at", "type": "TIMESTAMPTZ"},
      {"name": "resolved_at", "type": "TIMESTAMPTZ"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "ticket_number", "customer_email", "status", "priority", "assigned_to"]
  },
  {
    "name": "ticket_messages",
    "display_name": "Messages",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "ticket_id", "type": "UUID", "required": true, "foreign_key": "tickets.id"},
      {"name": "message", "type": "TEXT", "required": true},
      {"name": "sender_type", "type": "TEXT", "required": true, "check": "sender_type IN (''customer'', ''agent'', ''system'')"},
      {"name": "sender_id", "type": "TEXT"},
      {"name": "sender_name", "type": "TEXT"},
      {"name": "attachments", "type": "JSONB", "default": "''[]''"},
      {"name": "is_internal", "type": "BOOLEAN", "default": "false"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "ticket_id"]
  },
  {
    "name": "knowledge_base",
    "display_name": "Knowledge Base",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "title", "type": "TEXT", "required": true},
      {"name": "slug", "type": "TEXT", "required": true},
      {"name": "content", "type": "TEXT", "required": true},
      {"name": "category", "type": "TEXT"},
      {"name": "tags", "type": "JSONB", "default": "''[]''"},
      {"name": "status", "type": "TEXT", "default": "draft", "check": "status IN (''draft'', ''published'', ''archived'')"},
      {"name": "views", "type": "INTEGER", "default": "0"},
      {"name": "helpful_yes", "type": "INTEGER", "default": "0"},
      {"name": "helpful_no", "type": "INTEGER", "default": "0"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "slug", "category", "status"]
  }
]'::jsonb,
'["tickets", "messages", "knowledge_base", "canned_responses", "sla", "reports"]'::jsonb),

-- Membership Template
('Membership', 'membership', 'Subscription-based membership with gated content', '🎟️', 'community',
'[
  {
    "name": "membership_plans",
    "display_name": "Plans",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "name", "type": "TEXT", "required": true},
      {"name": "slug", "type": "TEXT", "required": true},
      {"name": "description", "type": "TEXT"},
      {"name": "price_monthly", "type": "NUMERIC(10,2)"},
      {"name": "price_yearly", "type": "NUMERIC(10,2)"},
      {"name": "currency", "type": "TEXT", "default": "''USD''"},
      {"name": "features", "type": "JSONB", "default": "''[]''"},
      {"name": "access_level", "type": "INTEGER", "default": "1"},
      {"name": "stripe_price_monthly_id", "type": "TEXT"},
      {"name": "stripe_price_yearly_id", "type": "TEXT"},
      {"name": "trial_days", "type": "INTEGER", "default": "0"},
      {"name": "active", "type": "BOOLEAN", "default": "true"},
      {"name": "sort_order", "type": "INTEGER", "default": "0"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "slug", "active"]
  },
  {
    "name": "members",
    "display_name": "Members",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "plan_id", "type": "UUID", "foreign_key": "membership_plans.id"},
      {"name": "email", "type": "TEXT", "required": true},
      {"name": "name", "type": "TEXT"},
      {"name": "avatar_url", "type": "TEXT"},
      {"name": "status", "type": "TEXT", "default": "active", "check": "status IN (''trialing'', ''active'', ''past_due'', ''cancelled'', ''expired'')"},
      {"name": "stripe_customer_id", "type": "TEXT"},
      {"name": "stripe_subscription_id", "type": "TEXT"},
      {"name": "current_period_start", "type": "TIMESTAMPTZ"},
      {"name": "current_period_end", "type": "TIMESTAMPTZ"},
      {"name": "cancelled_at", "type": "TIMESTAMPTZ"},
      {"name": "metadata", "type": "JSONB", "default": "''{}''"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "plan_id", "email", "status", "stripe_customer_id"]
  },
  {
    "name": "content",
    "display_name": "Content",
    "columns": [
      {"name": "id", "type": "UUID", "primary": true, "default": "gen_random_uuid()"},
      {"name": "sub_saas_id", "type": "UUID", "required": true, "foreign_key": "sub_saas_apps.id"},
      {"name": "title", "type": "TEXT", "required": true},
      {"name": "slug", "type": "TEXT", "required": true},
      {"name": "type", "type": "TEXT", "default": "article", "check": "type IN (''article'', ''video'', ''course'', ''download'', ''webinar'')"},
      {"name": "content", "type": "TEXT"},
      {"name": "excerpt", "type": "TEXT"},
      {"name": "thumbnail_url", "type": "TEXT"},
      {"name": "media_url", "type": "TEXT"},
      {"name": "access_level", "type": "INTEGER", "default": "0"},
      {"name": "status", "type": "TEXT", "default": "draft", "check": "status IN (''draft'', ''published'', ''archived'')"},
      {"name": "published_at", "type": "TIMESTAMPTZ"},
      {"name": "metadata", "type": "JSONB", "default": "''{}''"},
      {"name": "created_at", "type": "TIMESTAMPTZ", "default": "now()"},
      {"name": "updated_at", "type": "TIMESTAMPTZ", "default": "now()"}
    ],
    "indexes": ["sub_saas_id", "slug", "type", "access_level", "status"]
  }
]'::jsonb,
'["plans", "members", "content", "payments", "content_gating", "emails"]'::jsonb),

-- Blank Template
('Blank', 'blank', 'Start from scratch - AI will build your tables', '📝', 'general',
'[]'::jsonb,
'[]'::jsonb);

-- =====================================================
-- FUNCTION: Create tables from template
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_sub_saas_tables(
    p_sub_saas_id UUID,
    p_template_slug TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_template RECORD;
    v_table JSONB;
    v_column JSONB;
    v_table_name TEXT;
    v_sql TEXT;
    v_created_tables TEXT[] := '{}';
    v_prefix TEXT;
BEGIN
    -- Get template
    SELECT * INTO v_template FROM public.sub_saas_templates WHERE slug = p_template_slug;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Template not found');
    END IF;
    
    -- Create unique prefix for this sub-saas
    v_prefix := 'ss_' || replace(p_sub_saas_id::text, '-', '_') || '_';
    
    -- Loop through tables in template
    FOR v_table IN SELECT * FROM jsonb_array_elements(v_template.tables)
    LOOP
        v_table_name := v_prefix || (v_table->>'name');
        
        -- Build CREATE TABLE SQL
        v_sql := 'CREATE TABLE IF NOT EXISTS public.' || quote_ident(v_table_name) || ' (';
        
        -- Add columns
        FOR v_column IN SELECT * FROM jsonb_array_elements(v_table->'columns')
        LOOP
            v_sql := v_sql || quote_ident(v_column->>'name') || ' ' || (v_column->>'type');
            
            -- Primary key
            IF (v_column->>'primary')::boolean IS TRUE THEN
                v_sql := v_sql || ' PRIMARY KEY';
            END IF;
            
            -- Not null
            IF (v_column->>'required')::boolean IS TRUE THEN
                v_sql := v_sql || ' NOT NULL';
            END IF;
            
            -- Default value
            IF v_column->>'default' IS NOT NULL THEN
                v_sql := v_sql || ' DEFAULT ' || (v_column->>'default');
            END IF;
            
            -- Check constraint
            IF v_column->>'check' IS NOT NULL THEN
                v_sql := v_sql || ' CHECK (' || (v_column->>'check') || ')';
            END IF;
            
            v_sql := v_sql || ', ';
        END LOOP;
        
        -- Remove trailing comma and close
        v_sql := rtrim(v_sql, ', ') || ')';
        
        -- Execute CREATE TABLE
        EXECUTE v_sql;
        
        -- Enable RLS
        EXECUTE 'ALTER TABLE public.' || quote_ident(v_table_name) || ' ENABLE ROW LEVEL SECURITY';
        
        -- Create RLS policy for sub-saas isolation
        EXECUTE 'CREATE POLICY "sub_saas_isolation" ON public.' || quote_ident(v_table_name) || 
                ' FOR ALL USING (sub_saas_id = ''' || p_sub_saas_id || '''::uuid)';
        
        -- Create indexes
        IF v_table->'indexes' IS NOT NULL THEN
            FOR v_column IN SELECT * FROM jsonb_array_elements_text(v_table->'indexes')
            LOOP
                EXECUTE 'CREATE INDEX IF NOT EXISTS idx_' || v_table_name || '_' || v_column || 
                        ' ON public.' || quote_ident(v_table_name) || '(' || quote_ident(v_column::text) || ')';
            END LOOP;
        END IF;
        
        -- Record in sub_saas_tables
        INSERT INTO public.sub_saas_tables (sub_saas_id, table_name, display_name, schema_definition, is_system)
        VALUES (p_sub_saas_id, v_table_name, v_table->>'display_name', v_table->'columns', true)
        ON CONFLICT (sub_saas_id, table_name) DO NOTHING;
        
        v_created_tables := array_append(v_created_tables, v_table_name);
    END LOOP;
    
    -- Update sub-saas features
    UPDATE public.sub_saas_apps 
    SET features_enabled = v_template.features,
        settings = COALESCE(settings, '{}'::jsonb) || v_template.default_settings
    WHERE id = p_sub_saas_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'template', p_template_slug,
        'tables_created', to_jsonb(v_created_tables),
        'features', v_template.features
    );
END;
$$;

-- =====================================================
-- FUNCTION: Add custom table to sub-saas
-- =====================================================

CREATE OR REPLACE FUNCTION public.add_sub_saas_table(
    p_sub_saas_id UUID,
    p_table_name TEXT,
    p_display_name TEXT,
    p_columns JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_full_table_name TEXT;
    v_column JSONB;
    v_sql TEXT;
BEGIN
    -- Create prefixed table name
    v_full_table_name := 'ss_' || replace(p_sub_saas_id::text, '-', '_') || '_' || p_table_name;
    
    -- Build CREATE TABLE SQL
    v_sql := 'CREATE TABLE IF NOT EXISTS public.' || quote_ident(v_full_table_name) || ' (';
    v_sql := v_sql || 'id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ';
    v_sql := v_sql || 'sub_saas_id UUID NOT NULL DEFAULT ''' || p_sub_saas_id || '''::uuid, ';
    
    -- Add custom columns
    FOR v_column IN SELECT * FROM jsonb_array_elements(p_columns)
    LOOP
        v_sql := v_sql || quote_ident(v_column->>'name') || ' ' || COALESCE(v_column->>'type', 'TEXT');
        
        IF (v_column->>'required')::boolean IS TRUE THEN
            v_sql := v_sql || ' NOT NULL';
        END IF;
        
        IF v_column->>'default' IS NOT NULL THEN
            v_sql := v_sql || ' DEFAULT ' || (v_column->>'default');
        END IF;
        
        v_sql := v_sql || ', ';
    END LOOP;
    
    -- Add timestamps
    v_sql := v_sql || 'created_at TIMESTAMPTZ DEFAULT now(), ';
    v_sql := v_sql || 'updated_at TIMESTAMPTZ DEFAULT now()';
    v_sql := v_sql || ')';
    
    -- Execute
    EXECUTE v_sql;
    
    -- Enable RLS
    EXECUTE 'ALTER TABLE public.' || quote_ident(v_full_table_name) || ' ENABLE ROW LEVEL SECURITY';
    
    -- Create isolation policy
    EXECUTE 'CREATE POLICY "sub_saas_isolation" ON public.' || quote_ident(v_full_table_name) || 
            ' FOR ALL USING (sub_saas_id = ''' || p_sub_saas_id || '''::uuid)';
    
    -- Create index on sub_saas_id
    EXECUTE 'CREATE INDEX idx_' || v_full_table_name || '_sub_saas ON public.' || 
            quote_ident(v_full_table_name) || '(sub_saas_id)';
    
    -- Record in metadata
    INSERT INTO public.sub_saas_tables (sub_saas_id, table_name, display_name, schema_definition, is_system)
    VALUES (p_sub_saas_id, v_full_table_name, p_display_name, p_columns, false);
    
    RETURN jsonb_build_object(
        'success', true,
        'table_name', v_full_table_name,
        'display_name', p_display_name
    );
END;
$$;

-- =====================================================
-- INDEXES & RLS
-- =====================================================

CREATE INDEX idx_sub_saas_templates_slug ON public.sub_saas_templates(slug);
CREATE INDEX idx_sub_saas_templates_category ON public.sub_saas_templates(category);

ALTER TABLE public.sub_saas_templates ENABLE ROW LEVEL SECURITY;

-- Public templates are visible to all
CREATE POLICY "Public templates visible to all"
    ON public.sub_saas_templates FOR SELECT
    USING (is_public = true OR tenant_id IN (
        SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
    ));

-- Only platform admins can manage templates (via service role)
