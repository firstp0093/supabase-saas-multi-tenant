// =====================================================
// GET ANALYTICS
// Usage reports, activity logs, and metrics
// For AI-driven analytics queries
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

  const adminKey = req.headers.get('X-Admin-Key')
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Admin key required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { report_type, tenant_id, start_date, end_date, limit } = await req.json()

  // ===== USAGE REPORT =====
  if (report_type === 'usage') {
    const query = supabase
      .from('usage_tracking')
      .select(`
        tenant_id,
        tenants(name, plan),
        metric,
        SUM(quantity)::int as total,
        COUNT(*)::int as count
      `)
      .gte('created_at', start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    if (tenant_id) query.eq('tenant_id', tenant_id)
    if (end_date) query.lte('created_at', end_date)

    const { data, error } = await query

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ usage: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== ACTIVITY LOGS =====
  if (report_type === 'activity') {
    const query = supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit || 100)

    if (tenant_id) query.eq('tenant_id', tenant_id)
    if (start_date) query.gte('created_at', start_date)
    if (end_date) query.lte('created_at', end_date)

    const { data, error } = await query

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ logs: data, count: data.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== API REQUESTS =====
  if (report_type === 'api_requests') {
    const query = supabase
      .from('api_request_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit || 100)

    if (tenant_id) query.eq('tenant_id', tenant_id)
    if (start_date) query.gte('created_at', start_date)
    if (end_date) query.lte('created_at', end_date)

    const { data, error } = await query

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Aggregate stats
    const stats = {
      total_requests: data.length,
      by_status: data.reduce((acc: any, log: any) => {
        const status = Math.floor(log.status_code / 100) * 100
        acc[status] = (acc[status] || 0) + 1
        return acc
      }, {}),
      by_endpoint: data.reduce((acc: any, log: any) => {
        acc[log.endpoint] = (acc[log.endpoint] || 0) + 1
        return acc
      }, {})
    }

    return new Response(JSON.stringify({ requests: data, stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== TENANT SUMMARY =====
  if (report_type === 'tenant_summary') {
    const { data, error } = await supabase
      .from('tenants')
      .select(`
        id,
        name,
        plan,
        created_at,
        tenant_users(count),
        usage_tracking(
          metric,
          SUM(quantity)::int as total
        )
      `)
      .gte('usage_tracking.created_at', start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ tenants: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== METRICS DASHBOARD =====
  if (report_type === 'dashboard') {
    const [tenantsResult, usersResult, apiResult] = await Promise.all([
      supabase.from('tenants').select('plan', { count: 'exact', head: true }),
      supabase.from('tenant_users').select('*', { count: 'exact', head: true }),
      supabase.from('api_request_log')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    ])

    return new Response(JSON.stringify({
      total_tenants: tenantsResult.count,
      total_users: usersResult.count,
      api_requests_24h: apiResult.data?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({
    error: 'Invalid report_type. Use: usage, activity, api_requests, tenant_summary, dashboard'
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
