-- =====================================================
-- TEAM MANAGEMENT SYSTEM
-- Invite members, manage roles, track activity
-- =====================================================

-- 1. Pending invitations
CREATE TABLE public.invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
    token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by UUID REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, email)
);

-- 2. User activity log
CREATE TABLE public.activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Add tracking columns to user_tenants
ALTER TABLE public.user_tenants ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id);
ALTER TABLE public.user_tenants ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE public.user_tenants ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE public.user_tenants ADD COLUMN IF NOT EXISTS invite_accepted_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX idx_invites_tenant ON public.invites(tenant_id);
CREATE INDEX idx_invites_email ON public.invites(email);
CREATE INDEX idx_invites_token ON public.invites(token);
CREATE INDEX idx_activity_log_tenant ON public.activity_log(tenant_id);
CREATE INDEX idx_activity_log_user ON public.activity_log(user_id);
CREATE INDEX idx_activity_log_created ON public.activity_log(created_at DESC);
CREATE INDEX idx_activity_log_action ON public.activity_log(action);

-- RLS
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view invites" ON public.invites
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Admins can manage invites" ON public.invites
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_tenants
            WHERE tenant_id = invites.tenant_id
            AND user_id = auth.uid()
            AND role IN ('owner', 'admin')
        )
    );

CREATE POLICY "Tenant isolation" ON public.activity_log
    FOR SELECT USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "System can insert" ON public.activity_log
    FOR INSERT WITH CHECK (true);
