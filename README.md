# Supabase Multi-Tenant SaaS Infrastructure

Complete guide for building multi-tenant SaaS applications with Supabase, Stripe integration, Cloudflare Pages deployment, and Google Ads message matching.

## SQL to Dump Database Structure

Here's the SQL to extract your complete database schema:

```sql
-- Full schema dump including tables, columns, types, constraints, RLS policies
SELECT 
    'TABLES' as section,
    table_schema,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'storage', 'vault', 'extensions')
ORDER BY table_schema, table_name, ordinal_position;

-- Foreign keys
SELECT 
    'FOREIGN_KEYS' as section,
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table,
    ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');

-- RLS Policies (critical for multi-tenant)
SELECT 
    'RLS_POLICIES' as section,
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname NOT IN ('pg_catalog', 'information_schema');

-- Indexes
SELECT 
    'INDEXES' as section,
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog', 'information_schema');
```

---

## High-Level Architecture

### Multi-Tenant Model (Column-Based with RLS)

The recommended approach uses a `tenant_id` column across all tables with Row Level Security policies:

```
┌─────────────────────────────────────────────────────────────┐
│  Supabase Auth (Single Project - All SaaS Apps)             │
│  ├── users table                                            │
│  └── JWT contains: user_id, tenant_id (via custom claims)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Core Tables (with tenant_id column)                        │
│  ├── tenants (id, name, stripe_customer_id, plan, ...)      │
│  ├── user_tenants (user_id, tenant_id, role)                │
│  ├── [your_app_tables] (*, tenant_id)                       │
│  └── RLS: WHERE tenant_id = auth.jwt()->>'tenant_id'        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  stripe schema (Mirrored via Stripe Sync Engine)            │
│  ├── customers                                              │
│  ├── subscriptions                                          │
│  ├── products / prices                                      │
│  └── invoices                                               │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Purpose |
| :-- | :-- |
| **Stripe Sync Engine** | Mirrors Stripe data to `stripe` schema automatically via webhooks |
| **Stripe Wrapper** | Alternative: Query Stripe API directly as foreign tables |
| **RLS Policies** | Enforce tenant isolation at database level |
| **Custom JWT Claims** | Embed `tenant_id` in auth token for RLS |
| **Edge Functions** | Handle provisioning, Stripe webhooks, cross-tenant operations |

---

## Edge Function: Tenant Provisioning Flow

```typescript
// supabase/functions/provision-tenant/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14"

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
  
  const { user_id, tenant_name, email } = await req.json()
  
  // 1. Create Stripe customer
  const stripeCustomer = await stripe.customers.create({
    email,
    metadata: { tenant_name }
  })
  
  // 2. Create tenant record
  const { data: tenant } = await supabase
    .from('tenants')
    .insert({
      name: tenant_name,
      stripe_customer_id: stripeCustomer.id,
      plan: 'free'
    })
    .select()
    .single()
  
  // 3. Link user to tenant
  await supabase.from('user_tenants').insert({
    user_id,
    tenant_id: tenant.id,
    role: 'owner'
  })
  
  // 4. Set custom claim for RLS
  await supabase.rpc('set_user_tenant_claim', { 
    user_id, 
    tenant_id: tenant.id 
  })
  
  return new Response(JSON.stringify({ tenant }))
})
```

### Stripe Webhook Handler

```typescript
// supabase/functions/stripe-webhook/index.ts
serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
  const signature = req.headers.get('stripe-signature')!
  
  const event = stripe.webhooks.constructEvent(
    await req.text(),
    signature,
    Deno.env.get('STRIPE_WEBHOOK_SECRET')!
  )
  
  // Stripe Sync Engine handles mirroring automatically
  // This handles custom business logic
  switch (event.type) {
    case 'customer.subscription.updated':
      // Update tenant plan based on subscription
      break
    case 'invoice.payment_failed':
      // Trigger dunning flow
      break
  }
})
```

---

## Migration SQL: Add Multi-Tenant Structure

```sql
-- 1. Create tenants table (links to Stripe customer)
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT UNIQUE, -- Links to stripe.customers.id
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create user-tenant junction (supports multi-tenant per user)
CREATE TABLE public.user_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, tenant_id)
);

-- 3. Add tenant_id to all your existing public tables
ALTER TABLE public.agents ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.workflows ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.crawlers ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.documents ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.mcp_servers ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.settings ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.pages ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.page_embeddings ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);

-- 4. Create indexes for tenant lookups
CREATE INDEX idx_agents_tenant ON public.agents(tenant_id);
CREATE INDEX idx_workflows_tenant ON public.workflows(tenant_id);
CREATE INDEX idx_crawlers_tenant ON public.crawlers(tenant_id);
CREATE INDEX idx_documents_tenant ON public.documents(tenant_id);
CREATE INDEX idx_mcp_servers_tenant ON public.mcp_servers(tenant_id);
CREATE INDEX idx_settings_tenant ON public.settings(tenant_id);
CREATE INDEX idx_pages_tenant ON public.pages(tenant_id);
CREATE INDEX idx_page_embeddings_tenant ON public.page_embeddings(tenant_id);
CREATE INDEX idx_user_tenants_user ON public.user_tenants(user_id);
CREATE INDEX idx_user_tenants_tenant ON public.user_tenants(tenant_id);

-- 5. Helper function: Get user's current tenant from JWT or default
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- First try JWT claim
    _tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
    
    -- Fall back to user's default tenant
    IF _tenant_id IS NULL THEN
        SELECT tenant_id INTO _tenant_id
        FROM public.user_tenants
        WHERE user_id = auth.uid() AND is_default = true
        LIMIT 1;
    END IF;
    
    -- Fall back to any tenant user belongs to
    IF _tenant_id IS NULL THEN
        SELECT tenant_id INTO _tenant_id
        FROM public.user_tenants
        WHERE user_id = auth.uid()
        LIMIT 1;
    END IF;
    
    RETURN _tenant_id;
END;
$$;

-- 6. Helper: Check if user has access to tenant
CREATE OR REPLACE FUNCTION public.user_has_tenant_access(check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_tenants
        WHERE user_id = auth.uid() AND tenant_id = check_tenant_id
    );
$$;
```

---

## RLS Policies

```sql
-- Enable RLS on all tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawlers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_embeddings ENABLE ROW LEVEL SECURITY;

-- Tenants: users can only see tenants they belong to
CREATE POLICY "Users can view their tenants" ON public.tenants
    FOR SELECT USING (public.user_has_tenant_access(id));

CREATE POLICY "Owners can update tenant" ON public.tenants
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.user_tenants 
                WHERE tenant_id = id AND user_id = auth.uid() AND role = 'owner')
    );

-- User_tenants: users see their own memberships, owners manage all
CREATE POLICY "Users see own memberships" ON public.user_tenants
    FOR SELECT USING (user_id = auth.uid() OR public.user_has_tenant_access(tenant_id));

CREATE POLICY "Owners manage memberships" ON public.user_tenants
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.user_tenants ut
                WHERE ut.tenant_id = user_tenants.tenant_id 
                AND ut.user_id = auth.uid() 
                AND ut.role IN ('owner', 'admin'))
    );

-- Generic policy for all app tables (repeat for each)
CREATE POLICY "Tenant isolation" ON public.agents
    FOR ALL USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Tenant isolation" ON public.workflows
    FOR ALL USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Tenant isolation" ON public.crawlers
    FOR ALL USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Tenant isolation" ON public.documents
    FOR ALL USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Tenant isolation" ON public.mcp_servers
    FOR ALL USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Tenant isolation" ON public.settings
    FOR ALL USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Tenant isolation" ON public.pages
    FOR ALL USING (tenant_id = public.get_current_tenant_id());

CREATE POLICY "Tenant isolation" ON public.page_embeddings
    FOR ALL USING (tenant_id = public.get_current_tenant_id());
```

---

## Page Deployment Data Model

```sql
-- Extend your existing pages table
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' 
    CHECK (status IN ('draft', 'preview', 'deployed'));
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS cloudflare_project TEXT;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS cloudflare_url TEXT;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS gads_config JSONB DEFAULT '{}';
-- gads_config: { "campaign_id": "xxx", "keywords": {"cheap": "affordable", "buy": "get started"} }

-- Track deployment history
CREATE TABLE public.page_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    page_id UUID REFERENCES public.pages(id),
    environment TEXT CHECK (environment IN ('preview', 'production')),
    cloudflare_deployment_id TEXT,
    html_hash TEXT, -- To detect changes
    deployed_at TIMESTAMPTZ DEFAULT now(),
    deployed_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.page_deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.page_deployments
    FOR ALL USING (tenant_id = public.get_current_tenant_id());
```

---

## Edge Function: Setup Page

Returns injectable snippets for your page generator to embed:

```typescript
// supabase/functions/setup-page/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SetupRequest {
  page_id: string
  environment: 'test' | 'production'
  features: {
    auth: boolean
    stripe: boolean
    gads_matching: boolean
  }
  gads_config?: {
    campaign_id?: string
    keywords?: Record<string, string>
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const authHeader = req.headers.get('Authorization')!
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  const { page_id, environment, features, gads_config }: SetupRequest = await req.json()
  
  // Get tenant for this user
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id, tenants(stripe_customer_id, plan)')
    .eq('user_id', user!.id)
    .single()
  
  const tenant_id = userTenant.tenant_id
  
  const isTest = environment === 'test'
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  
  const stripePublishableKey = isTest 
    ? Deno.env.get('STRIPE_TEST_PUBLISHABLE_KEY')!
    : Deno.env.get('STRIPE_LIVE_PUBLISHABLE_KEY')!

  const snippets: Record<string, string> = {}
  
  // HEAD SNIPPET
  snippets.head = `
<!-- Supabase SaaS Setup - ${environment.toUpperCase()} -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
${features.stripe ? '<script src="https://js.stripe.com/v3/"></script>' : ''}
<script>
  window.__SAAS_CONFIG__ = {
    supabaseUrl: "${supabaseUrl}",
    supabaseKey: "${supabaseAnonKey}",
    tenantId: "${tenant_id}",
    pageId: "${page_id}",
    environment: "${environment}",
    ${features.stripe ? `stripeKey: "${stripePublishableKey}",` : ''}
    ${features.gads_matching ? `gadsEndpoint: "${supabaseUrl}/functions/v1/gads-message-match",` : ''}
  };
</script>
`.trim()

  // AUTH SNIPPET
  if (features.auth) {
    snippets.auth_init = `
<script>
  const supabase = window.supabase.createClient(
    window.__SAAS_CONFIG__.supabaseUrl,
    window.__SAAS_CONFIG__.supabaseKey
  );
  
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      document.body.classList.add('authenticated');
      document.body.classList.remove('anonymous');
      window.__SAAS_USER__ = session.user;
    } else {
      document.body.classList.remove('authenticated');
      document.body.classList.add('anonymous');
      window.__SAAS_USER__ = null;
    }
    document.dispatchEvent(new CustomEvent('saas:auth', { detail: { event, session }}));
  });
  
  window.saasAuth = {
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password) => supabase.auth.signUp({ email, password }),
    signOut: () => supabase.auth.signOut(),
    getUser: () => supabase.auth.getUser(),
    google: () => supabase.auth.signInWithOAuth({ provider: 'google' }),
  };
</script>

<style>
  .authenticated .show-anonymous { display: none !important; }
  .anonymous .show-authenticated { display: none !important; }
</style>
`.trim()
  }

  // STRIPE SNIPPET
  if (features.stripe) {
    snippets.stripe_init = `
<script>
  const stripe = Stripe(window.__SAAS_CONFIG__.stripeKey);
  
  window.saasStripe = {
    checkout: async (priceId, mode = 'subscription') => {
      const response = await fetch(window.__SAAS_CONFIG__.supabaseUrl + '/functions/v1/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session?.access_token
        },
        body: JSON.stringify({
          tenant_id: window.__SAAS_CONFIG__.tenantId,
          price_id: priceId,
          mode: mode,
          success_url: window.location.href + '?checkout=success',
          cancel_url: window.location.href + '?checkout=cancelled'
        })
      });
      const { url } = await response.json();
      window.location.href = url;
    },
    
    portal: async () => {
      const response = await fetch(window.__SAAS_CONFIG__.supabaseUrl + '/functions/v1/customer-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session?.access_token
        },
        body: JSON.stringify({ tenant_id: window.__SAAS_CONFIG__.tenantId })
      });
      const { url } = await response.json();
      window.location.href = url;
    }
  };
</script>
`.trim()
  }

  // GOOGLE ADS MESSAGE MATCHING
  if (features.gads_matching) {
    snippets.gads_init = `
<script>
  (async function() {
    const params = new URLSearchParams(window.location.search);
    const gclid = params.get('gclid');
    const keyword = params.get('keyword') || params.get('utm_term');
    
    if (!gclid && !keyword) return;
    
    try {
      const response = await fetch(window.__SAAS_CONFIG__.gadsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: window.__SAAS_CONFIG__.pageId,
          gclid: gclid,
          keyword: keyword,
          url: window.location.href
        })
      });
      
      const { replacements } = await response.json();
      
      if (replacements) {
        Object.entries(replacements).forEach(([selector, text]) => {
          document.querySelectorAll('[data-gads="' + selector + '"]').forEach(el => {
            el.textContent = text;
          });
        });
      }
    } catch (e) {
      console.warn('GAds matching failed:', e);
    }
  })();
</script>
`.trim()
  }

  if (gads_config) {
    await supabase
      .from('pages')
      .update({ gads_config })
      .eq('id', page_id)
      .eq('tenant_id', tenant_id)
  }

  return new Response(JSON.stringify({
    environment,
    tenant_id,
    page_id,
    snippets,
    instructions: {
      head: "Add snippets.head inside your <head> tag",
      auth: features.auth ? "Add snippets.auth_init after head, add snippets.auth_form where you want the login UI" : null,
      stripe: features.stripe ? "Add snippets.stripe_init after auth, use data-price-id on buttons" : null,
      gads: features.gads_matching ? "Add snippets.gads_init before </body>, use data-gads attributes on elements" : null,
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
```

---

## Edge Function: Deploy Page to Cloudflare

```typescript
// supabase/functions/deploy-page/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const CF_ACCOUNT_ID = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')!
  const CF_API_TOKEN = Deno.env.get('CLOUDFLARE_API_TOKEN')!
  
  const authHeader = req.headers.get('Authorization')!
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  const { page_id, project_name } = await req.json()
  
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user!.id)
    .single()
  
  const tenant_id = userTenant.tenant_id
  
  const { data: page, error: pageError } = await supabase
    .from('pages')
    .select('*')
    .eq('id', page_id)
    .eq('tenant_id', tenant_id)
    .single()
  
  if (pageError || !page) {
    return new Response(JSON.stringify({ error: 'Page not found' }), { 
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Swap test credentials for production
  let html = page.content
  const liveStripeKey = Deno.env.get('STRIPE_LIVE_PUBLISHABLE_KEY')!
  html = html.replace(/stripeKey:\s*"pk_test_[^"]+"/g, `stripeKey: "${liveStripeKey}"`)
  html = html.replace(/environment:\s*"test"/g, 'environment: "production"')
  
  const htmlHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  const hashHex = Array.from(new Uint8Array(htmlHash)).map(b => b.toString(16).padStart(2, '0')).join('')

  const cfProjectName = project_name || page.cloudflare_project || `saas-${tenant_id.slice(0, 8)}-${page_id.slice(0, 8)}`
  
  // Ensure project exists
  const projectCheck = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${cfProjectName}`,
    { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` } }
  )
  
  if (projectCheck.status === 404) {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: cfProjectName, production_branch: 'main' })
      }
    )
  }
  
  // Deploy
  const formData = new FormData()
  const manifest = { '/index.html': hashHex }
  formData.append('manifest', JSON.stringify(manifest))
  const htmlBlob = new Blob([html], { type: 'text/html' })
  formData.append(hashHex, htmlBlob, 'index.html')
  
  const deployResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${cfProjectName}/deployments`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: formData
    }
  )
  
  const deployResult = await deployResponse.json()
  
  if (!deployResult.success) {
    return new Response(JSON.stringify({ error: deployResult.errors }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const deployment = deployResult.result
  const liveUrl = `https://${cfProjectName}.pages.dev`
  
  await supabase
    .from('pages')
    .update({
      status: 'deployed',
      cloudflare_project: cfProjectName,
      cloudflare_url: liveUrl,
      deployed_at: new Date().toISOString()
    })
    .eq('id', page_id)
  
  await supabase.from('page_deployments').insert({
    tenant_id,
    page_id,
    environment: 'production',
    cloudflare_deployment_id: deployment.id,
    html_hash: hashHex,
    deployed_by: user!.id
  })
  
  return new Response(JSON.stringify({
    success: true,
    deployment_id: deployment.id,
    url: liveUrl,
    preview_url: deployment.url,
    project: cfProjectName
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
```

---

## Edge Function: Google Ads Message Matching

```typescript
// supabase/functions/gads-message-match/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { page_id, gclid, keyword, url } = await req.json()
  
  const { data: page } = await supabase
    .from('pages')
    .select('gads_config, tenant_id')
    .eq('id', page_id)
    .single()
  
  if (!page?.gads_config) {
    return new Response(JSON.stringify({ replacements: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const config = page.gads_config
  let replacements = config.default || {}
  
  if (keyword && config.keywords) {
    if (config.keywords[keyword.toLowerCase()]) {
      replacements = { ...replacements, ...config.keywords[keyword.toLowerCase()] }
    } else {
      for (const [key, values] of Object.entries(config.keywords)) {
        if (keyword.toLowerCase().includes(key.toLowerCase())) {
          replacements = { ...replacements, ...values }
          break
        }
      }
    }
  }
  
  // Log for analytics
  await supabase.from('gads_impressions').insert({
    tenant_id: page.tenant_id,
    page_id,
    gclid,
    keyword,
    url,
    matched_config: Object.keys(replacements).length > 0
  }).catch(() => {})
  
  return new Response(JSON.stringify({ replacements }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
```

---

## Google Ads Analytics Table

```sql
CREATE TABLE public.gads_impressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    page_id UUID REFERENCES public.pages(id),
    gclid TEXT,
    keyword TEXT,
    url TEXT,
    matched_config BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gads_impressions_tenant ON public.gads_impressions(tenant_id);
CREATE INDEX idx_gads_impressions_page ON public.gads_impressions(page_id);
CREATE INDEX idx_gads_impressions_keyword ON public.gads_impressions(keyword);

ALTER TABLE public.gads_impressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.gads_impressions
    FOR ALL USING (tenant_id = public.get_current_tenant_id());
```

---

## Usage Example

```typescript
// STEP 1: Get setup snippets during development
const setupResponse = await fetch(`${SUPABASE_URL}/functions/v1/setup-page`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    page_id: 'uuid-of-page',
    environment: 'test',
    features: { auth: true, stripe: true, gads_matching: true },
    gads_config: {
      keywords: {
        "cheap": { headline: "Affordable Pricing for Everyone", cta: "Save 50% Today" },
        "enterprise": { headline: "Enterprise-Grade Solution", cta: "Contact Sales" },
        "free trial": { headline: "Start Your Free Trial", cta: "Try Free for 14 Days" }
      },
      default: { headline: "Welcome to Our Platform", cta: "Get Started" }
    }
  })
})

const { snippets } = await setupResponse.json()
// → Inject snippets.head, snippets.auth_init, etc. into your generated HTML

// STEP 2: Deploy to production
const deployResponse = await fetch(`${SUPABASE_URL}/functions/v1/deploy-page`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    page_id: 'uuid-of-page',
    project_name: 'my-landing-page'
  })
})

const { url } = await deployResponse.json()
// → https://my-landing-page.pages.dev
```

---

## Environment Variables

| Variable | Description |
| :-- | :-- |
| `STRIPE_TEST_PUBLISHABLE_KEY` | `pk_test_...` for dev |
| `STRIPE_LIVE_PUBLISHABLE_KEY` | `pk_live_...` for production |
| `STRIPE_TEST_SECRET_KEY` | `sk_test_...` |
| `STRIPE_LIVE_SECRET_KEY` | `sk_live_...` |
| `CLOUDFLARE_ACCOUNT_ID` | Your CF account ID |
| `CLOUDFLARE_API_TOKEN` | CF API token with Pages edit permission |

---

## Architecture Flow

```
User Signs Up → provision-tenant Edge Function
      │
      ├─→ Creates Stripe Customer (auto-syncs to stripe.customers)
      ├─→ Creates public.tenants record
      └─→ Creates public.user_tenants (owner role)

User Upgrades → create-checkout Edge Function
      │
      └─→ Stripe Checkout → stripe-webhook
                              │
                              └─→ Updates tenants.plan based on subscription

All Queries → RLS automatically filters by get_current_tenant_id()
```
