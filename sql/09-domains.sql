-- =====================================================
-- DOMAIN MANAGEMENT
-- Each tenant can have multiple domains
-- Emails sent from the domain of the page being managed
-- =====================================================

-- 1. Domains table
CREATE TABLE public.domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,
    
    -- Verification
    is_verified BOOLEAN DEFAULT false,
    verification_token TEXT DEFAULT encode(gen_random_bytes(16), 'hex'),
    verified_at TIMESTAMPTZ,
    
    -- Email configuration
    email_enabled BOOLEAN DEFAULT false,
    email_from_name TEXT,  -- e.g., "Acme Support"
    email_from_address TEXT,  -- e.g., "hello" (becomes hello@domain.com)
    resend_domain_id TEXT,  -- Resend's domain ID after verification
    
    -- DNS configuration
    dns_configured BOOLEAN DEFAULT false,
    dns_records JSONB DEFAULT '[]',  -- Required DNS records
    
    -- SSL/Cloudflare
    cloudflare_zone_id TEXT,
    ssl_status TEXT DEFAULT 'pending',
    
    -- Status
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Domain verification log
CREATE TABLE public.domain_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id UUID NOT NULL REFERENCES public.domains(id) ON DELETE CASCADE,
    verification_type TEXT NOT NULL,  -- 'dns', 'email', 'txt_record'
    status TEXT DEFAULT 'pending',  -- 'pending', 'success', 'failed'
    details JSONB DEFAULT '{}',
    checked_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Email templates per domain
CREATE TABLE public.email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    domain_id UUID REFERENCES public.domains(id) ON DELETE SET NULL,
    
    name TEXT NOT NULL,  -- 'team_invite', 'welcome', 'password_reset'
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    text_content TEXT,
    
    variables JSONB DEFAULT '[]',  -- Available variables like {{invite_url}}, {{tenant_name}}
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id, domain_id, name)
);

-- 4. Email send log
CREATE TABLE public.email_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    domain_id UUID REFERENCES public.domains(id) ON DELETE SET NULL,
    
    to_email TEXT NOT NULL,
    from_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    template_name TEXT,
    
    resend_id TEXT,  -- Resend's message ID
    status TEXT DEFAULT 'sent',  -- 'sent', 'delivered', 'bounced', 'failed'
    error_message TEXT,
    
    metadata JSONB DEFAULT '{}',
    
    sent_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Link pages to domains
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS domain_id UUID REFERENCES public.domains(id) ON DELETE SET NULL;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS custom_domain TEXT;

-- Indexes
CREATE INDEX idx_domains_tenant ON public.domains(tenant_id);
CREATE INDEX idx_domains_domain ON public.domains(domain);
CREATE INDEX idx_domains_verified ON public.domains(is_verified) WHERE is_verified = true;
CREATE INDEX idx_email_templates_tenant ON public.email_templates(tenant_id);
CREATE INDEX idx_email_templates_name ON public.email_templates(name);
CREATE INDEX idx_email_log_tenant ON public.email_log(tenant_id);
CREATE INDEX idx_email_log_domain ON public.email_log(domain_id);
CREATE INDEX idx_pages_domain ON public.pages(domain_id);

-- RLS
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Domains: tenant members can view, admins can manage
CREATE POLICY "Tenant members can view domains" ON public.domains
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Admins can manage domains" ON public.domains
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_tenants
            WHERE tenant_id = domains.tenant_id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
    );

-- Domain verifications: same as domains
CREATE POLICY "Tenant isolation" ON public.domain_verifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.domains
            WHERE id = domain_verifications.domain_id
            AND tenant_id = public.get_current_tenant_id()
        )
    );

-- Email templates: tenant isolation
CREATE POLICY "Tenant isolation" ON public.email_templates
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Admins can manage templates" ON public.email_templates
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_tenants
            WHERE tenant_id = email_templates.tenant_id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
    );

-- Email log: tenant isolation (read only)
CREATE POLICY "Tenant isolation" ON public.email_log
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "System insert" ON public.email_log
    FOR INSERT WITH CHECK (true);

-- Seed: Default email templates
INSERT INTO public.email_templates (tenant_id, name, subject, html_content, text_content, variables) VALUES
(
    (SELECT id FROM public.tenants LIMIT 1),
    'team_invite',
    'You''ve been invited to join {{tenant_name}}',
    '<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">You''re invited!</h2>
  <p style="color: #666; font-size: 16px; line-height: 1.5;">{{inviter_name}} has invited you to join <strong>{{tenant_name}}</strong> as a {{role}}.</p>
  <a href="{{invite_url}}" style="display: inline-block; background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">Accept Invitation</a>
  <p style="color: #999; font-size: 14px;">This invitation expires on {{expires_at}}.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">If you didn''t expect this invitation, you can ignore this email.</p>
</body>
</html>',
    'You''ve been invited to join {{tenant_name}}!\n\n{{inviter_name}} has invited you to join as a {{role}}.\n\nAccept your invitation: {{invite_url}}\n\nThis invitation expires on {{expires_at}}.',
    '["tenant_name", "inviter_name", "role", "invite_url", "expires_at"]'
)
ON CONFLICT (tenant_id, domain_id, name) DO NOTHING;
