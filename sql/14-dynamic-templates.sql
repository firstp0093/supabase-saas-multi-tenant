-- =====================================================
-- DYNAMIC TEMPLATES SYSTEM
-- Store and manage templates in database
-- Templates can be added/edited without redeploying
-- =====================================================

-- 1. Template Definitions
CREATE TABLE public.sub_saas_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT, -- emoji or icon name
    category TEXT DEFAULT 'general',
    
    -- Template content
    tables JSONB NOT NULL DEFAULT '[]', -- Array of table definitions
    features JSONB NOT NULL DEFAULT '[]', -- Array of feature flags
    default_settings JSONB DEFAULT '{}', -- Default app settings
    default_branding JSONB DEFAULT '{}', -- Default branding
    
    -- Sample data (optional)
    seed_data JSONB DEFAULT '{}', -- Sample data to populate tables
    
    -- Visibility
    is_public BOOLEAN DEFAULT true, -- Available to all tenants
    tenant_id UUID REFERENCES public.tenants(id), -- If private, belongs to this tenant
    
    -- Metadata
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Template Table Schemas (detailed column definitions)
CREATE TABLE public.template_table_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES public.sub_saas_templates(id) ON DELETE CASCADE,
    
    -- Table info
    table_name TEXT NOT NULL, -- e.g., 'contacts'
    display_name TEXT NOT NULL, -- e.g., 'Contacts'
    description TEXT,
    icon TEXT,
    
    -- Schema
    columns JSONB NOT NULL DEFAULT '[]', -- Array of column definitions
    indexes JSONB DEFAULT '[]', -- Array of index definitions
    
    -- Options
    enable_rls BOOLEAN DEFAULT true,
    enable_audit BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false, -- Can't be deleted by user
    sort_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(template_id, table_name)
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_templates_slug ON public.sub_saas_templates(slug);
CREATE INDEX idx_templates_category ON public.sub_saas_templates(category);
CREATE INDEX idx_templates_public ON public.sub_saas_templates(is_public) WHERE is_public = true;
CREATE INDEX idx_templates_tenant ON public.sub_saas_templates(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_template_schemas_template ON public.template_table_schemas(template_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.sub_saas_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_table_schemas ENABLE ROW LEVEL SECURITY;

-- Public templates visible to all, private only to owner tenant
CREATE POLICY "View public templates or own templates"
    ON public.sub_saas_templates FOR SELECT
    USING (
        is_public = true 
        OR tenant_id IN (
            SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
        )
    );

-- Only platform admins can create public templates
-- Tenant admins can create private templates
CREATE POLICY "Manage templates"
    ON public.sub_saas_templates FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id FROM public.user_tenants 
            WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
        )
    );

-- Template schemas follow template visibility
CREATE POLICY "View template schemas"
    ON public.template_table_schemas FOR SELECT
    USING (
        template_id IN (
            SELECT id FROM public.sub_saas_templates 
            WHERE is_public = true 
            OR tenant_id IN (
                SELECT tenant_id FROM public.user_tenants WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Manage template schemas"
    ON public.template_table_schemas FOR ALL
    USING (
        template_id IN (
            SELECT id FROM public.sub_saas_templates 
            WHERE tenant_id IN (
                SELECT tenant_id FROM public.user_tenants 
                WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
            )
        )
    );

-- =====================================================
-- SEED DEFAULT TEMPLATES
-- =====================================================

-- CRM Template
INSERT INTO public.sub_saas_templates (slug, name, description, icon, category, features, default_settings)
VALUES (
    'crm',
    'CRM',
    'Customer relationship management with contacts, deals, and pipeline tracking',
    '👥',
    'business',
    '["contacts", "deals", "pipeline", "activities", "notes", "tasks"]',
    '{"pipeline_stages": ["lead", "qualified", "proposal", "negotiation", "won", "lost"]}'
);

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'contacts', 'Contacts', 'People and companies you do business with', '👤',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "name", "type": "text", "required": true, "label": "Full Name"},
    {"name": "email", "type": "text", "required": true, "label": "Email", "unique": true},
    {"name": "phone", "type": "text", "label": "Phone"},
    {"name": "company", "type": "text", "label": "Company"},
    {"name": "title", "type": "text", "label": "Job Title"},
    {"name": "status", "type": "text", "default": "lead", "label": "Status", "enum": ["lead", "customer", "churned", "inactive"]},
    {"name": "source", "type": "text", "label": "Lead Source"},
    {"name": "notes", "type": "text", "label": "Notes"},
    {"name": "tags", "type": "jsonb", "default": "[]", "label": "Tags"},
    {"name": "custom_fields", "type": "jsonb", "default": "{}", "label": "Custom Fields"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"},
    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]', 1
FROM public.sub_saas_templates WHERE slug = 'crm';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'deals', 'Deals', 'Sales opportunities and their progress', '💰',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "title", "type": "text", "required": true, "label": "Deal Title"},
    {"name": "contact_id", "type": "uuid", "references": "contacts", "label": "Contact"},
    {"name": "value", "type": "numeric", "label": "Deal Value"},
    {"name": "currency", "type": "text", "default": "USD", "label": "Currency"},
    {"name": "stage", "type": "text", "default": "lead", "label": "Pipeline Stage", "enum": ["lead", "qualified", "proposal", "negotiation", "won", "lost"]},
    {"name": "probability", "type": "integer", "default": 0, "label": "Win Probability %"},
    {"name": "expected_close", "type": "date", "label": "Expected Close Date"},
    {"name": "actual_close", "type": "date", "label": "Actual Close Date"},
    {"name": "notes", "type": "text", "label": "Notes"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"},
    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]', 2
FROM public.sub_saas_templates WHERE slug = 'crm';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'activities', 'Activities', 'Calls, emails, meetings, and tasks', '📋',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "type", "type": "text", "required": true, "label": "Type", "enum": ["call", "email", "meeting", "task", "note"]},
    {"name": "subject", "type": "text", "required": true, "label": "Subject"},
    {"name": "description", "type": "text", "label": "Description"},
    {"name": "contact_id", "type": "uuid", "references": "contacts", "label": "Contact"},
    {"name": "deal_id", "type": "uuid", "references": "deals", "label": "Deal"},
    {"name": "due_date", "type": "timestamptz", "label": "Due Date"},
    {"name": "completed", "type": "boolean", "default": false, "label": "Completed"},
    {"name": "completed_at", "type": "timestamptz", "label": "Completed At"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
]', 3
FROM public.sub_saas_templates WHERE slug = 'crm';

-- Booking Template
INSERT INTO public.sub_saas_templates (slug, name, description, icon, category, features, default_settings)
VALUES (
    'booking',
    'Booking & Appointments',
    'Service booking system with calendar, availability, and reminders',
    '📅',
    'services',
    '["services", "bookings", "calendar", "availability", "reminders", "customers"]',
    '{"time_zone": "UTC", "booking_window_days": 30, "cancellation_hours": 24}'
);

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'services', 'Services', 'Services you offer for booking', '🛎️',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "name", "type": "text", "required": true, "label": "Service Name"},
    {"name": "description", "type": "text", "label": "Description"},
    {"name": "duration_minutes", "type": "integer", "required": true, "default": 60, "label": "Duration (minutes)"},
    {"name": "price", "type": "numeric", "label": "Price"},
    {"name": "currency", "type": "text", "default": "USD", "label": "Currency"},
    {"name": "category", "type": "text", "label": "Category"},
    {"name": "image_url", "type": "text", "label": "Image URL"},
    {"name": "max_attendees", "type": "integer", "default": 1, "label": "Max Attendees"},
    {"name": "buffer_before", "type": "integer", "default": 0, "label": "Buffer Before (min)"},
    {"name": "buffer_after", "type": "integer", "default": 0, "label": "Buffer After (min)"},
    {"name": "active", "type": "boolean", "default": true, "label": "Active"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
]', 1
FROM public.sub_saas_templates WHERE slug = 'booking';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'bookings', 'Bookings', 'Scheduled appointments', '📆',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "service_id", "type": "uuid", "required": true, "references": "services", "label": "Service"},
    {"name": "customer_name", "type": "text", "required": true, "label": "Customer Name"},
    {"name": "customer_email", "type": "text", "required": true, "label": "Customer Email"},
    {"name": "customer_phone", "type": "text", "label": "Customer Phone"},
    {"name": "start_time", "type": "timestamptz", "required": true, "label": "Start Time"},
    {"name": "end_time", "type": "timestamptz", "required": true, "label": "End Time"},
    {"name": "status", "type": "text", "default": "pending", "label": "Status", "enum": ["pending", "confirmed", "completed", "cancelled", "no_show"]},
    {"name": "notes", "type": "text", "label": "Notes"},
    {"name": "payment_status", "type": "text", "default": "unpaid", "label": "Payment", "enum": ["unpaid", "paid", "refunded"]},
    {"name": "payment_amount", "type": "numeric", "label": "Amount Paid"},
    {"name": "reminder_sent", "type": "boolean", "default": false},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
]', 2
FROM public.sub_saas_templates WHERE slug = 'booking';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'availability', 'Availability', 'Working hours and blocked times', '⏰',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "day_of_week", "type": "integer", "label": "Day (0=Sun, 6=Sat)"},
    {"name": "start_time", "type": "time", "label": "Start Time"},
    {"name": "end_time", "type": "time", "label": "End Time"},
    {"name": "is_available", "type": "boolean", "default": true},
    {"name": "specific_date", "type": "date", "label": "Specific Date (for overrides)"},
    {"name": "service_id", "type": "uuid", "references": "services", "label": "Service (optional)"}
]', 3
FROM public.sub_saas_templates WHERE slug = 'booking';

-- E-commerce Template
INSERT INTO public.sub_saas_templates (slug, name, description, icon, category, features, default_settings)
VALUES (
    'ecommerce',
    'E-commerce Store',
    'Online store with products, orders, inventory, and payments',
    '🛒',
    'commerce',
    '["products", "orders", "cart", "inventory", "payments", "customers", "discounts"]',
    '{"currency": "USD", "tax_rate": 0, "shipping_enabled": true}'
);

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'products', 'Products', 'Items for sale', '📦',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "name", "type": "text", "required": true, "label": "Product Name"},
    {"name": "slug", "type": "text", "unique": true, "label": "URL Slug"},
    {"name": "description", "type": "text", "label": "Description"},
    {"name": "price", "type": "numeric", "required": true, "label": "Price"},
    {"name": "compare_at_price", "type": "numeric", "label": "Compare at Price"},
    {"name": "cost", "type": "numeric", "label": "Cost"},
    {"name": "sku", "type": "text", "label": "SKU"},
    {"name": "barcode", "type": "text", "label": "Barcode"},
    {"name": "inventory_quantity", "type": "integer", "default": 0, "label": "Inventory"},
    {"name": "track_inventory", "type": "boolean", "default": true},
    {"name": "category", "type": "text", "label": "Category"},
    {"name": "tags", "type": "jsonb", "default": "[]", "label": "Tags"},
    {"name": "images", "type": "jsonb", "default": "[]", "label": "Images"},
    {"name": "variants", "type": "jsonb", "default": "[]", "label": "Variants"},
    {"name": "weight", "type": "numeric", "label": "Weight (kg)"},
    {"name": "active", "type": "boolean", "default": true, "label": "Active"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"},
    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]', 1
FROM public.sub_saas_templates WHERE slug = 'ecommerce';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'orders', 'Orders', 'Customer orders', '🧾',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "order_number", "type": "text", "unique": true, "label": "Order #"},
    {"name": "customer_email", "type": "text", "required": true, "label": "Customer Email"},
    {"name": "customer_name", "type": "text", "label": "Customer Name"},
    {"name": "items", "type": "jsonb", "required": true, "label": "Line Items"},
    {"name": "subtotal", "type": "numeric", "required": true, "label": "Subtotal"},
    {"name": "tax", "type": "numeric", "default": 0, "label": "Tax"},
    {"name": "shipping_cost", "type": "numeric", "default": 0, "label": "Shipping"},
    {"name": "discount", "type": "numeric", "default": 0, "label": "Discount"},
    {"name": "total", "type": "numeric", "required": true, "label": "Total"},
    {"name": "currency", "type": "text", "default": "USD"},
    {"name": "status", "type": "text", "default": "pending", "label": "Status", "enum": ["pending", "processing", "shipped", "delivered", "cancelled", "refunded"]},
    {"name": "payment_status", "type": "text", "default": "unpaid", "enum": ["unpaid", "paid", "refunded", "failed"]},
    {"name": "payment_intent_id", "type": "text"},
    {"name": "shipping_address", "type": "jsonb", "label": "Shipping Address"},
    {"name": "billing_address", "type": "jsonb", "label": "Billing Address"},
    {"name": "tracking_number", "type": "text", "label": "Tracking #"},
    {"name": "notes", "type": "text", "label": "Notes"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"},
    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]', 2
FROM public.sub_saas_templates WHERE slug = 'ecommerce';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'customers', 'Customers', 'Store customers', '👤',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "email", "type": "text", "required": true, "unique": true, "label": "Email"},
    {"name": "name", "type": "text", "label": "Name"},
    {"name": "phone", "type": "text", "label": "Phone"},
    {"name": "addresses", "type": "jsonb", "default": "[]", "label": "Addresses"},
    {"name": "total_orders", "type": "integer", "default": 0},
    {"name": "total_spent", "type": "numeric", "default": 0},
    {"name": "tags", "type": "jsonb", "default": "[]"},
    {"name": "notes", "type": "text"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
]', 3
FROM public.sub_saas_templates WHERE slug = 'ecommerce';

-- Helpdesk Template
INSERT INTO public.sub_saas_templates (slug, name, description, icon, category, features, default_settings)
VALUES (
    'helpdesk',
    'Helpdesk & Support',
    'Customer support system with tickets, knowledge base, and SLA tracking',
    '🎫',
    'support',
    '["tickets", "messages", "knowledge_base", "canned_responses", "sla", "assignments"]',
    '{"priorities": ["low", "medium", "high", "urgent"], "default_sla_hours": 24}'
);

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'tickets', 'Tickets', 'Support tickets', '🎫',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "ticket_number", "type": "text", "unique": true, "label": "Ticket #"},
    {"name": "subject", "type": "text", "required": true, "label": "Subject"},
    {"name": "description", "type": "text", "required": true, "label": "Description"},
    {"name": "customer_email", "type": "text", "required": true, "label": "Customer Email"},
    {"name": "customer_name", "type": "text", "label": "Customer Name"},
    {"name": "status", "type": "text", "default": "open", "label": "Status", "enum": ["open", "pending", "in_progress", "resolved", "closed"]},
    {"name": "priority", "type": "text", "default": "medium", "label": "Priority", "enum": ["low", "medium", "high", "urgent"]},
    {"name": "category", "type": "text", "label": "Category"},
    {"name": "assigned_to", "type": "uuid", "label": "Assigned To"},
    {"name": "tags", "type": "jsonb", "default": "[]"},
    {"name": "sla_due_at", "type": "timestamptz", "label": "SLA Due"},
    {"name": "first_response_at", "type": "timestamptz"},
    {"name": "resolved_at", "type": "timestamptz"},
    {"name": "satisfaction_rating", "type": "integer", "label": "CSAT (1-5)"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"},
    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]', 1
FROM public.sub_saas_templates WHERE slug = 'helpdesk';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'ticket_messages', 'Messages', 'Ticket replies and notes', '💬',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "ticket_id", "type": "uuid", "required": true, "references": "tickets", "label": "Ticket"},
    {"name": "message", "type": "text", "required": true, "label": "Message"},
    {"name": "sender_type", "type": "text", "default": "customer", "enum": ["customer", "agent", "system"]},
    {"name": "sender_name", "type": "text"},
    {"name": "sender_email", "type": "text"},
    {"name": "is_internal", "type": "boolean", "default": false, "label": "Internal Note"},
    {"name": "attachments", "type": "jsonb", "default": "[]"},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
]', 2
FROM public.sub_saas_templates WHERE slug = 'helpdesk';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'knowledge_base', 'Knowledge Base', 'Help articles and FAQs', '📚',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "title", "type": "text", "required": true, "label": "Title"},
    {"name": "slug", "type": "text", "unique": true, "label": "URL Slug"},
    {"name": "content", "type": "text", "required": true, "label": "Content"},
    {"name": "category", "type": "text", "label": "Category"},
    {"name": "tags", "type": "jsonb", "default": "[]"},
    {"name": "views", "type": "integer", "default": 0},
    {"name": "helpful_yes", "type": "integer", "default": 0},
    {"name": "helpful_no", "type": "integer", "default": 0},
    {"name": "published", "type": "boolean", "default": false},
    {"name": "created_at", "type": "timestamptz", "default": "now()"},
    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]', 3
FROM public.sub_saas_templates WHERE slug = 'helpdesk';

-- Membership Template
INSERT INTO public.sub_saas_templates (slug, name, description, icon, category, features, default_settings)
VALUES (
    'membership',
    'Membership & Subscriptions',
    'Membership site with plans, gated content, and recurring billing',
    '🏆',
    'membership',
    '["plans", "members", "content", "billing", "access_control", "community"]',
    '{"trial_days": 7, "grace_period_days": 3}'
);

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'membership_plans', 'Plans', 'Membership tiers', '📋',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "name", "type": "text", "required": true, "label": "Plan Name"},
    {"name": "slug", "type": "text", "unique": true},
    {"name": "description", "type": "text", "label": "Description"},
    {"name": "price_monthly", "type": "numeric", "label": "Monthly Price"},
    {"name": "price_yearly", "type": "numeric", "label": "Yearly Price"},
    {"name": "currency", "type": "text", "default": "USD"},
    {"name": "features", "type": "jsonb", "default": "[]", "label": "Features List"},
    {"name": "access_level", "type": "integer", "default": 1, "label": "Access Level"},
    {"name": "stripe_price_monthly", "type": "text"},
    {"name": "stripe_price_yearly", "type": "text"},
    {"name": "max_members", "type": "integer", "label": "Max Members (null=unlimited)"},
    {"name": "active", "type": "boolean", "default": true},
    {"name": "sort_order", "type": "integer", "default": 0},
    {"name": "created_at", "type": "timestamptz", "default": "now()"}
]', 1
FROM public.sub_saas_templates WHERE slug = 'membership';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'members', 'Members', 'Subscribed members', '👤',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "email", "type": "text", "required": true, "unique": true, "label": "Email"},
    {"name": "name", "type": "text", "label": "Name"},
    {"name": "plan_id", "type": "uuid", "references": "membership_plans", "label": "Plan"},
    {"name": "status", "type": "text", "default": "active", "enum": ["trialing", "active", "past_due", "cancelled", "expired"]},
    {"name": "billing_cycle", "type": "text", "default": "monthly", "enum": ["monthly", "yearly"]},
    {"name": "stripe_customer_id", "type": "text"},
    {"name": "stripe_subscription_id", "type": "text"},
    {"name": "trial_ends_at", "type": "timestamptz"},
    {"name": "current_period_start", "type": "timestamptz"},
    {"name": "current_period_end", "type": "timestamptz"},
    {"name": "cancelled_at", "type": "timestamptz"},
    {"name": "joined_at", "type": "timestamptz", "default": "now()"},
    {"name": "last_login_at", "type": "timestamptz"},
    {"name": "metadata", "type": "jsonb", "default": "{}"}
]', 2
FROM public.sub_saas_templates WHERE slug = 'membership';

INSERT INTO public.template_table_schemas (template_id, table_name, display_name, description, icon, columns, sort_order)
SELECT id, 'content', 'Content', 'Gated content and resources', '📄',
'[
    {"name": "id", "type": "uuid", "primary": true, "default": "gen_random_uuid()"},
    {"name": "title", "type": "text", "required": true, "label": "Title"},
    {"name": "slug", "type": "text", "unique": true},
    {"name": "type", "type": "text", "default": "article", "enum": ["article", "video", "download", "course", "lesson"]},
    {"name": "content", "type": "text", "label": "Content/Body"},
    {"name": "excerpt", "type": "text", "label": "Excerpt"},
    {"name": "featured_image", "type": "text", "label": "Featured Image URL"},
    {"name": "video_url", "type": "text", "label": "Video URL"},
    {"name": "download_url", "type": "text", "label": "Download URL"},
    {"name": "min_access_level", "type": "integer", "default": 1, "label": "Min Access Level"},
    {"name": "category", "type": "text"},
    {"name": "tags", "type": "jsonb", "default": "[]"},
    {"name": "published", "type": "boolean", "default": false},
    {"name": "published_at", "type": "timestamptz"},
    {"name": "views", "type": "integer", "default": 0},
    {"name": "created_at", "type": "timestamptz", "default": "now()"},
    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
]', 3
FROM public.sub_saas_templates WHERE slug = 'membership';

-- Blank Template (minimal)
INSERT INTO public.sub_saas_templates (slug, name, description, icon, category, features, default_settings)
VALUES (
    'blank',
    'Blank',
    'Start from scratch - AI will build the schema based on your requirements',
    '📝',
    'general',
    '[]',
    '{}'
);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Get template with all schemas
CREATE OR REPLACE FUNCTION public.get_template_with_schemas(template_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'template', row_to_json(t),
        'schemas', COALESCE((
            SELECT jsonb_agg(row_to_json(s) ORDER BY s.sort_order)
            FROM public.template_table_schemas s
            WHERE s.template_id = t.id
        ), '[]'::jsonb)
    ) INTO result
    FROM public.sub_saas_templates t
    WHERE t.slug = template_slug AND t.is_active = true;
    
    RETURN result;
END;
$$;

-- List all available templates
CREATE OR REPLACE FUNCTION public.list_templates(for_tenant_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'slug', t.slug,
            'name', t.name,
            'description', t.description,
            'icon', t.icon,
            'category', t.category,
            'features', t.features,
            'table_count', (SELECT COUNT(*) FROM public.template_table_schemas WHERE template_id = t.id)
        ) ORDER BY t.category, t.name)
        FROM public.sub_saas_templates t
        WHERE t.is_active = true
        AND (t.is_public = true OR t.tenant_id = for_tenant_id)
    ), '[]'::jsonb);
END;
$$;

-- =====================================================
-- UPDATE TRIGGER
-- =====================================================

CREATE TRIGGER update_templates_updated_at
    BEFORE UPDATE ON public.sub_saas_templates
    FOR EACH ROW EXECUTE FUNCTION public.update_sub_saas_updated_at();
