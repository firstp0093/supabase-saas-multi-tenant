// =====================================================
// MANAGE SUB-SAAS
// Manage existing sub-SaaS applications
// List, update, delete, manage users, view metrics
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

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

  // Get authenticated user
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

  if (!isAdmin && !membership) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const body = await req.json()
  const { action, sub_saas_id } = body
  const tenantId = isAdmin ? body.tenant_id : membership?.tenant_id

  // Helper to verify sub-saas access
  async function verifyAccess(subSaasId: string): Promise<any> {
    const { data } = await supabase
      .from('sub_saas_apps')
      .select('*')
      .eq('id', subSaasId)
      .single()

    if (!data) return null
    if (isAdmin) return data
    if (data.tenant_id === tenantId) return data
    return null
  }

  // ===== LIST SUB-SAAS APPS =====
  if (action === 'list') {
    try {
      let query = supabase
        .from('sub_saas_apps')
        .select(`
          id, name, slug, description, template,
          subdomain, custom_domain, status,
          stripe_connect_enabled, stripe_onboarding_complete,
          max_users, created_at
        `)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })

      if (!isAdmin) {
        query = query.eq('tenant_id', tenantId)
      } else if (body.tenant_id) {
        query = query.eq('tenant_id', body.tenant_id)
      }

      const { data, error } = await query

      if (error) throw error

      // Get user counts for each app
      const appsWithCounts = await Promise.all(
        (data || []).map(async (app) => {
          const { count } = await supabase
            .from('sub_saas_users')
            .select('*', { count: 'exact', head: true })
            .eq('sub_saas_id', app.id)

          return { ...app, user_count: count || 0 }
        })
      )

      return new Response(JSON.stringify({ apps: appsWithCounts }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET SUB-SAAS APP =====
  if (action === 'get') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get user count
    const { count: userCount } = await supabase
      .from('sub_saas_users')
      .select('*', { count: 'exact', head: true })
      .eq('sub_saas_id', sub_saas_id)

    // Get Stripe Connect info if enabled
    let stripeConnect = null
    if (app.stripe_connect_enabled) {
      const { data } = await supabase
        .from('stripe_connect_accounts')
        .select('*')
        .eq('sub_saas_id', sub_saas_id)
        .single()
      stripeConnect = data
    }

    return new Response(JSON.stringify({
      app: {
        ...app,
        user_count: userCount || 0,
        stripe_connect: stripeConnect
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== UPDATE SUB-SAAS APP =====
  if (action === 'update') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { name, description, settings, branding, status, custom_domain, max_users } = body

    const updates: any = {}
    if (name) updates.name = name
    if (description !== undefined) updates.description = description
    if (settings) updates.settings = { ...app.settings, ...settings }
    if (branding) updates.branding = { ...app.branding, ...branding }
    if (status && ['active', 'paused', 'suspended'].includes(status)) updates.status = status
    if (custom_domain !== undefined) updates.custom_domain = custom_domain || null
    if (max_users) updates.max_users = max_users

    const { data, error } = await supabase
      .from('sub_saas_apps')
      .update(updates)
      .eq('id', sub_saas_id)
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true, app: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== DELETE SUB-SAAS APP =====
  if (action === 'delete') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Soft delete
    const { error } = await supabase
      .from('sub_saas_apps')
      .update({ status: 'deleted' })
      .eq('id', sub_saas_id)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== LIST USERS =====
  if (action === 'list_users') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data, error } = await supabase
      .from('sub_saas_users')
      .select('id, email, name, role, subscription_status, subscription_plan, last_login_at, created_at')
      .eq('sub_saas_id', sub_saas_id)
      .order('created_at', { ascending: false })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ users: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== ADD USER =====
  if (action === 'add_user') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { user_email, user_name, user_role = 'user' } = body

    if (!user_email) {
      return new Response(JSON.stringify({ error: 'user_email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check user limit
    const { count } = await supabase
      .from('sub_saas_users')
      .select('*', { count: 'exact', head: true })
      .eq('sub_saas_id', sub_saas_id)

    if ((count || 0) >= app.max_users) {
      return new Response(JSON.stringify({ error: `User limit reached (${app.max_users})` }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data, error } = await supabase
      .from('sub_saas_users')
      .insert({
        sub_saas_id,
        email: user_email,
        name: user_name,
        role: user_role
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return new Response(JSON.stringify({ error: 'User already exists' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true, user: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== REMOVE USER =====
  if (action === 'remove_user') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { user_id, user_email } = body

    if (!user_id && !user_email) {
      return new Response(JSON.stringify({ error: 'user_id or user_email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let query = supabase
      .from('sub_saas_users')
      .delete()
      .eq('sub_saas_id', sub_saas_id)

    if (user_id) {
      query = query.eq('id', user_id)
    } else {
      query = query.eq('email', user_email)
    }

    const { error } = await query

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== GET METRICS =====
  if (action === 'get_metrics') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const app = await verifyAccess(sub_saas_id)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // User metrics
    const { count: totalUsers } = await supabase
      .from('sub_saas_users')
      .select('*', { count: 'exact', head: true })
      .eq('sub_saas_id', sub_saas_id)

    const { count: activeSubscriptions } = await supabase
      .from('sub_saas_users')
      .select('*', { count: 'exact', head: true })
      .eq('sub_saas_id', sub_saas_id)
      .eq('subscription_status', 'active')

    // Payment metrics (if Stripe Connect enabled)
    let paymentMetrics = null
    if (app.stripe_connect_enabled) {
      const { data: payments } = await supabase
        .from('sub_saas_payments')
        .select('amount, status')
        .eq('sub_saas_id', sub_saas_id)
        .eq('status', 'succeeded')

      const totalRevenue = (payments || []).reduce((sum, p) => sum + p.amount, 0)

      paymentMetrics = {
        total_revenue: totalRevenue / 100, // Convert cents to dollars
        total_transactions: payments?.length || 0
      }
    }

    // Recent signups (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { count: recentSignups } = await supabase
      .from('sub_saas_users')
      .select('*', { count: 'exact', head: true })
      .eq('sub_saas_id', sub_saas_id)
      .gte('created_at', thirtyDaysAgo.toISOString())

    return new Response(JSON.stringify({
      metrics: {
        total_users: totalUsers || 0,
        max_users: app.max_users,
        active_subscriptions: activeSubscriptions || 0,
        recent_signups_30d: recentSignups || 0,
        payments: paymentMetrics,
        status: app.status
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({
    error: 'Invalid action',
    available_actions: ['list', 'get', 'update', 'delete', 'list_users', 'add_user', 'remove_user', 'get_metrics']
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
