// =====================================================
// MANAGE SUB-SAAS
// List, update, delete sub-SaaS apps and manage users
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

  const { action, sub_saas_id, settings, user_email, user_role, tenant_id: overrideTenantId } = await req.json()
  const tenantId = isAdmin && overrideTenantId ? overrideTenantId : membership?.tenant_id

  // ===== LIST SUB-SAAS APPS =====
  if (action === 'list') {
    try {
      let query = supabase
        .from('sub_saas_apps')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })

      if (!isAdmin && tenantId) {
        query = query.eq('tenant_id', tenantId)
      }

      const { data, error } = await query

      if (error) throw error

      return new Response(JSON.stringify({ sub_saas_apps: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET SINGLE SUB-SAAS =====
  if (action === 'get') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { data, error } = await supabase
        .from('sub_saas_apps')
        .select(`
          *,
          sub_saas_users(count),
          sub_saas_tables(*)
        `)
        .eq('id', sub_saas_id)
        .single()

      if (error) throw error

      return new Response(JSON.stringify({ sub_saas: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== UPDATE SUB-SAAS =====
  if (action === 'update') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const updates: any = { updated_at: new Date().toISOString() }
      if (settings?.name) updates.name = settings.name
      if (settings?.description !== undefined) updates.description = settings.description
      if (settings?.branding) updates.branding = settings.branding
      if (settings?.features) updates.features = settings.features
      if (settings?.custom_domain !== undefined) updates.custom_domain = settings.custom_domain
      if (settings?.settings) updates.settings = settings.settings

      const { data, error } = await supabase
        .from('sub_saas_apps')
        .update(updates)
        .eq('id', sub_saas_id)
        .select()
        .single()

      if (error) throw error

      return new Response(JSON.stringify({ success: true, sub_saas: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== DELETE (SOFT) SUB-SAAS =====
  if (action === 'delete') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { error } = await supabase
        .from('sub_saas_apps')
        .update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('id', sub_saas_id)

      if (error) throw error

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== LIST USERS =====
  if (action === 'list_users') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { data, error } = await supabase
        .from('sub_saas_users')
        .select('*')
        .eq('sub_saas_id', sub_saas_id)
        .order('created_at', { ascending: false })

      if (error) throw error

      return new Response(JSON.stringify({ users: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== ADD USER =====
  if (action === 'add_user') {
    if (!sub_saas_id || !user_email) {
      return new Response(JSON.stringify({ error: 'sub_saas_id and user_email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { data, error } = await supabase
        .from('sub_saas_users')
        .insert({
          sub_saas_id,
          email: user_email,
          role: user_role || 'user'
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return new Response(JSON.stringify({ error: 'User already exists in this app' }), {
            status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        throw error
      }

      // Update user count
      await supabase.rpc('update_sub_saas_metrics', { app_id: sub_saas_id })

      return new Response(JSON.stringify({ success: true, user: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== REMOVE USER =====
  if (action === 'remove_user') {
    if (!sub_saas_id || !user_email) {
      return new Response(JSON.stringify({ error: 'sub_saas_id and user_email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      const { error } = await supabase
        .from('sub_saas_users')
        .delete()
        .eq('sub_saas_id', sub_saas_id)
        .eq('email', user_email)

      if (error) throw error

      // Update user count
      await supabase.rpc('update_sub_saas_metrics', { app_id: sub_saas_id })

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== GET METRICS =====
  if (action === 'get_metrics') {
    if (!sub_saas_id) {
      return new Response(JSON.stringify({ error: 'sub_saas_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    try {
      // Update metrics first
      await supabase.rpc('update_sub_saas_metrics', { app_id: sub_saas_id })

      const { data: app } = await supabase
        .from('sub_saas_apps')
        .select('user_count, monthly_revenue, created_at')
        .eq('id', sub_saas_id)
        .single()

      const { data: recentUsers } = await supabase
        .from('sub_saas_users')
        .select('created_at')
        .eq('sub_saas_id', sub_saas_id)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

      const { data: recentPayments } = await supabase
        .from('sub_saas_payments')
        .select('amount, created_at')
        .eq('sub_saas_id', sub_saas_id)
        .eq('status', 'succeeded')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

      return new Response(JSON.stringify({
        metrics: {
          total_users: app?.user_count || 0,
          monthly_revenue: app?.monthly_revenue || 0,
          new_users_7d: recentUsers?.length || 0,
          payments_30d: recentPayments?.length || 0,
          revenue_30d: recentPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0,
          created_at: app?.created_at
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  return new Response(JSON.stringify({
    error: 'Invalid action',
    available_actions: ['list', 'get', 'update', 'delete', 'list_users', 'add_user', 'remove_user', 'get_metrics']
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
