// =====================================================
// CREATE SUB-SAAS
// Creates a new sub-SaaS application for a tenant
// Supports templates, Stripe Connect, custom domains
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const PLATFORM_DOMAIN = Deno.env.get('PLATFORM_DOMAIN') || 'yourplatform.com'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  const adminKey = req.headers.get('X-Admin-Key')
  const isAdmin = adminKey === ADMIN_KEY

  // Get authenticated user
  let user: any = null
  let membership: any = null

  if (authHeader) {
    const { data: { user: authUser } } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authUser) {
      user = authUser
      // Get user's tenant membership
      const { data: m } = await supabase
        .from('user_tenants')
        .select('tenant_id, role, tenants(id, name, plan)')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      membership = m
    }
  }

  // Must be authenticated and have admin/owner role (or platform admin)
  if (!isAdmin && (!membership || !['owner', 'admin'].includes(membership.role))) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const body = await req.json()
  const { 
    name, 
    slug, 
    description,
    template = 'blank',
    enable_stripe_connect = false,
    custom_domain,
    settings = {},
    branding = {}
  } = body

  // Validation
  if (!name || !slug) {
    return new Response(JSON.stringify({ error: 'name and slug are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Validate slug format
  const slugRegex = /^[a-z0-9-]+$/
  if (!slugRegex.test(slug)) {
    return new Response(JSON.stringify({ error: 'slug must be lowercase alphanumeric with hyphens only' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const tenantId = isAdmin ? body.tenant_id : membership.tenant_id

  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'tenant_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    // Check if slug is available
    const { data: existing } = await supabase
      .from('sub_saas_apps')
      .select('id')
      .or(`slug.eq.${slug},subdomain.eq.${slug}`)
      .single()

    if (existing) {
      return new Response(JSON.stringify({ error: 'Slug already taken' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check tenant's sub-saas limit based on plan
    const { data: tenant } = await supabase
      .from('tenants')
      .select('plan')
      .eq('id', tenantId)
      .single()

    const planLimits: Record<string, number> = {
      free: 1,
      starter: 3,
      pro: 10,
      enterprise: 100
    }

    const { count: currentCount } = await supabase
      .from('sub_saas_apps')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('status', 'deleted')

    const limit = planLimits[tenant?.plan || 'free']
    if ((currentCount || 0) >= limit) {
      return new Response(JSON.stringify({ 
        error: `Plan limit reached. ${tenant?.plan || 'free'} plan allows ${limit} sub-apps. Upgrade to create more.`
      }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create the sub-saas app
    const subdomain = `${slug}.${PLATFORM_DOMAIN}`
    
    const { data: subSaas, error: createError } = await supabase
      .from('sub_saas_apps')
      .insert({
        tenant_id: tenantId,
        name,
        slug,
        description,
        template,
        subdomain,
        custom_domain: custom_domain || null,
        branding,
        settings,
        stripe_connect_enabled: enable_stripe_connect,
        status: 'active'
      })
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Apply template if not blank
    if (template !== 'blank') {
      await applyTemplate(supabase, subSaas.id, template)
    }

    // Set up Stripe Connect if enabled
    let stripeConnect = null
    if (enable_stripe_connect && STRIPE_SECRET_KEY) {
      stripeConnect = await setupStripeConnect(supabase, subSaas.id, tenantId, name)
    }

    return new Response(JSON.stringify({
      success: true,
      sub_saas: {
        id: subSaas.id,
        name: subSaas.name,
        slug: subSaas.slug,
        subdomain: subSaas.subdomain,
        custom_domain: subSaas.custom_domain,
        template: subSaas.template,
        status: subSaas.status,
        url: `https://${subSaas.subdomain}`
      },
      stripe_connect: stripeConnect
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// =====================================================
// TEMPLATE DEFINITIONS
// =====================================================

const templates: Record<string, { tables: any[], features: string[] }> = {
  crm: {
    tables: [
      {
        name: 'contacts',
        display_name: 'Contacts',
        schema: [
          { name: 'name', type: 'text', required: true },
          { name: 'email', type: 'text', required: true },
          { name: 'phone', type: 'text' },
          { name: 'company', type: 'text' },
          { name: 'status', type: 'text', default: 'lead' },
          { name: 'notes', type: 'text' }
        ]
      },
      {
        name: 'deals',
        display_name: 'Deals',
        schema: [
          { name: 'title', type: 'text', required: true },
          { name: 'value', type: 'numeric' },
          { name: 'stage', type: 'text', default: 'discovery' },
          { name: 'contact_id', type: 'uuid' },
          { name: 'close_date', type: 'date' }
        ]
      }
    ],
    features: ['contacts', 'deals', 'pipeline', 'activities']
  },
  booking: {
    tables: [
      {
        name: 'services',
        display_name: 'Services',
        schema: [
          { name: 'name', type: 'text', required: true },
          { name: 'description', type: 'text' },
          { name: 'duration_minutes', type: 'integer', default: 60 },
          { name: 'price', type: 'numeric' },
          { name: 'active', type: 'boolean', default: true }
        ]
      },
      {
        name: 'bookings',
        display_name: 'Bookings',
        schema: [
          { name: 'service_id', type: 'uuid', required: true },
          { name: 'customer_name', type: 'text', required: true },
          { name: 'customer_email', type: 'text', required: true },
          { name: 'start_time', type: 'timestamptz', required: true },
          { name: 'end_time', type: 'timestamptz', required: true },
          { name: 'status', type: 'text', default: 'pending' },
          { name: 'notes', type: 'text' }
        ]
      }
    ],
    features: ['services', 'bookings', 'calendar', 'reminders']
  },
  ecommerce: {
    tables: [
      {
        name: 'products',
        display_name: 'Products',
        schema: [
          { name: 'name', type: 'text', required: true },
          { name: 'description', type: 'text' },
          { name: 'price', type: 'numeric', required: true },
          { name: 'sku', type: 'text' },
          { name: 'inventory', type: 'integer', default: 0 },
          { name: 'active', type: 'boolean', default: true },
          { name: 'images', type: 'jsonb', default: '[]' }
        ]
      },
      {
        name: 'orders',
        display_name: 'Orders',
        schema: [
          { name: 'customer_email', type: 'text', required: true },
          { name: 'items', type: 'jsonb', required: true },
          { name: 'total', type: 'numeric', required: true },
          { name: 'status', type: 'text', default: 'pending' },
          { name: 'shipping_address', type: 'jsonb' },
          { name: 'payment_intent_id', type: 'text' }
        ]
      }
    ],
    features: ['products', 'orders', 'cart', 'payments', 'inventory']
  },
  helpdesk: {
    tables: [
      {
        name: 'tickets',
        display_name: 'Tickets',
        schema: [
          { name: 'subject', type: 'text', required: true },
          { name: 'description', type: 'text', required: true },
          { name: 'customer_email', type: 'text', required: true },
          { name: 'priority', type: 'text', default: 'medium' },
          { name: 'status', type: 'text', default: 'open' },
          { name: 'assigned_to', type: 'uuid' }
        ]
      },
      {
        name: 'ticket_messages',
        display_name: 'Messages',
        schema: [
          { name: 'ticket_id', type: 'uuid', required: true },
          { name: 'message', type: 'text', required: true },
          { name: 'sender_type', type: 'text', default: 'customer' },
          { name: 'sender_id', type: 'text' }
        ]
      }
    ],
    features: ['tickets', 'messages', 'assignments', 'sla']
  },
  membership: {
    tables: [
      {
        name: 'membership_plans',
        display_name: 'Membership Plans',
        schema: [
          { name: 'name', type: 'text', required: true },
          { name: 'description', type: 'text' },
          { name: 'price_monthly', type: 'numeric' },
          { name: 'price_yearly', type: 'numeric' },
          { name: 'features', type: 'jsonb', default: '[]' },
          { name: 'active', type: 'boolean', default: true }
        ]
      },
      {
        name: 'members',
        display_name: 'Members',
        schema: [
          { name: 'email', type: 'text', required: true },
          { name: 'name', type: 'text' },
          { name: 'plan_id', type: 'uuid' },
          { name: 'status', type: 'text', default: 'active' },
          { name: 'joined_at', type: 'timestamptz' },
          { name: 'expires_at', type: 'timestamptz' }
        ]
      }
    ],
    features: ['plans', 'members', 'billing', 'content_gating']
  }
}

async function applyTemplate(supabase: any, subSaasId: string, templateName: string) {
  const template = templates[templateName]
  if (!template) return

  // Record the tables in metadata
  for (const table of template.tables) {
    await supabase
      .from('sub_saas_tables')
      .insert({
        sub_saas_id: subSaasId,
        table_name: `ss_${subSaasId.replace(/-/g, '_')}_${table.name}`,
        display_name: table.display_name,
        schema_definition: table.schema,
        is_system: true
      })
  }

  // Update features
  await supabase
    .from('sub_saas_apps')
    .update({ features_enabled: template.features })
    .eq('id', subSaasId)
}

async function setupStripeConnect(supabase: any, subSaasId: string, tenantId: string, businessName: string) {
  const stripeHeaders = {
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  }

  try {
    // Create connected account (Express type for easier onboarding)
    const accountResponse = await fetch('https://api.stripe.com/v1/accounts', {
      method: 'POST',
      headers: stripeHeaders,
      body: new URLSearchParams({
        'type': 'express',
        'business_type': 'company',
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
        'metadata[sub_saas_id]': subSaasId,
        'metadata[tenant_id]': tenantId
      })
    })
    
    const account = await accountResponse.json()

    if (account.error) {
      throw new Error(account.error.message)
    }

    // Save to database
    await supabase
      .from('stripe_connect_accounts')
      .insert({
        sub_saas_id: subSaasId,
        tenant_id: tenantId,
        stripe_account_id: account.id,
        account_type: 'express',
        business_name: businessName
      })

    // Update sub-saas app
    await supabase
      .from('sub_saas_apps')
      .update({ stripe_account_id: account.id })
      .eq('id', subSaasId)

    return {
      account_id: account.id,
      onboarding_required: true
    }

  } catch (error) {
    console.error('Stripe Connect setup failed:', error)
    return null
  }
}
