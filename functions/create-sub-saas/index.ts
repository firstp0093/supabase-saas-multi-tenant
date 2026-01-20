// =====================================================
// CREATE SUB-SAAS
// Creates a new sub-SaaS application for a tenant (B2B2C)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  const adminKey = req.headers.get('X-Admin-Key')
  const isAdmin = adminKey === ADMIN_KEY

  // Get user and tenant
  let user: any = null
  let membership: any = null

  if (authHeader) {
    const { data: { user: authUser } } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authUser) {
      user = authUser
      const { data: m } = await supabase
        .from('user_tenants')
        .select('tenant_id, role')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      membership = m
    }
  }

  if (!user && !isAdmin) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Only owners/admins can create sub-SaaS apps
  if (!isAdmin && membership?.role !== 'owner' && membership?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin or owner role required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { 
    name, 
    slug, 
    description,
    template = 'blank', 
    enable_stripe_connect = false,
    custom_domain,
    tenant_id: overrideTenantId
  } = await req.json()

  if (!name || !slug) {
    return new Response(JSON.stringify({ error: 'name and slug are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return new Response(JSON.stringify({ error: 'slug must be lowercase alphanumeric with hyphens only' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const tenantId = isAdmin && overrideTenantId ? overrideTenantId : membership?.tenant_id

  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'No tenant found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    // Get template if specified
    let templateData: any = null
    if (template !== 'blank') {
      const { data: tmpl } = await supabase
        .from('sub_saas_templates')
        .select('*')
        .eq('name', template)
        .single()
      templateData = tmpl
    }

    // Create sub-SaaS app
    const { data: subSaas, error: createError } = await supabase
      .from('sub_saas_apps')
      .insert({
        tenant_id: tenantId,
        name,
        slug,
        description,
        template,
        settings: templateData?.settings || {},
        branding: templateData?.branding || { primary_color: '#3B82F6', logo_url: null },
        features: templateData?.settings?.features || [],
        custom_domain,
        stripe_connect_enabled: enable_stripe_connect
      })
      .select()
      .single()

    if (createError) {
      if (createError.code === '23505') { // Unique violation
        return new Response(JSON.stringify({ error: 'A sub-SaaS with this slug already exists' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      throw createError
    }

    // Create tables from template
    if (templateData?.tables) {
      for (const tableDef of templateData.tables) {
        await supabase
          .from('sub_saas_tables')
          .insert({
            sub_saas_id: subSaas.id,
            table_name: tableDef.name,
            schema_definition: { columns: tableDef.columns }
          })
      }
    }

    // Create Stripe Connect account if requested
    let stripeConnectUrl = null
    if (enable_stripe_connect && STRIPE_SECRET_KEY) {
      try {
        // Create connected account
        const accountResponse = await fetch('https://api.stripe.com/v1/accounts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            'type': 'express',
            'country': 'US',
            'capabilities[card_payments][requested]': 'true',
            'capabilities[transfers][requested]': 'true',
            'metadata[sub_saas_id]': subSaas.id,
            'metadata[tenant_id]': tenantId
          })
        })
        const account = await accountResponse.json()

        if (account.id) {
          // Update sub-SaaS with account ID
          await supabase
            .from('sub_saas_apps')
            .update({ stripe_connect_account_id: account.id })
            .eq('id', subSaas.id)

          // Generate onboarding link
          const linkResponse = await fetch('https://api.stripe.com/v1/account_links', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              'account': account.id,
              'refresh_url': `${Deno.env.get('SUPABASE_URL')}/sub-saas/${subSaas.slug}/stripe-refresh`,
              'return_url': `${Deno.env.get('SUPABASE_URL')}/sub-saas/${subSaas.slug}/stripe-complete`,
              'type': 'account_onboarding'
            })
          })
          const link = await linkResponse.json()
          stripeConnectUrl = link.url

          subSaas.stripe_connect_account_id = account.id
        }
      } catch (stripeError) {
        console.error('Stripe Connect error:', stripeError)
        // Don't fail the whole operation, just note the error
      }
    }

    // Add current user as owner of the sub-SaaS
    if (user) {
      await supabase
        .from('sub_saas_users')
        .insert({
          sub_saas_id: subSaas.id,
          auth_user_id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email,
          role: 'owner'
        })
    }

    return new Response(JSON.stringify({
      success: true,
      sub_saas: subSaas,
      stripe_connect_onboarding_url: stripeConnectUrl,
      template_applied: template,
      tables_created: templateData?.tables?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
