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
  
  const authHeader = req.headers.get('Authorization')
  let tenant_id: string | null = null
  let plan = 'free'
  
  if (authHeader?.startsWith('Bearer ')) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (user) {
      const { data: userTenant } = await supabase
        .from('user_tenants')
        .select('tenant_id, tenants(plan)')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      tenant_id = userTenant?.tenant_id
      plan = userTenant?.tenants?.plan || 'free'
    }
  }
  
  const { feature, quantity = 1, tenant_id: bodyTenantId } = await req.json()
  
  if (bodyTenantId) {
    tenant_id = bodyTenantId
    const { data: tenant } = await supabase.from('tenants').select('plan').eq('id', tenant_id).single()
    plan = tenant?.plan || 'free'
  }
  
  if (!tenant_id) {
    return new Response(JSON.stringify({ error: 'No tenant found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Get limit
  const { data: limitConfig } = await supabase
    .from('plan_limits')
    .select('*')
    .eq('plan', plan)
    .eq('feature', feature)
    .single()
  
  if (!limitConfig || limitConfig.limit_value === -1) {
    return new Response(JSON.stringify({
      allowed: true, feature, current: 0, limit: -1, remaining: -1, period: 'unlimited', plan, upgrade_required: false
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  
  // Calculate usage
  let currentUsage = 0
  
  if (limitConfig.period === 'total') {
    if (feature === 'pages') {
      const { count } = await supabase.from('pages').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant_id)
      currentUsage = count || 0
    } else if (feature === 'team_members') {
      const { count } = await supabase.from('user_tenants').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant_id)
      currentUsage = count || 0
    }
  } else {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    
    const { data: usageRecord } = await supabase
      .from('usage_records')
      .select('value')
      .eq('tenant_id', tenant_id)
      .eq('feature', feature)
      .gte('period_start', periodStart.toISOString())
      .lte('period_end', periodEnd.toISOString())
      .single()
    currentUsage = usageRecord?.value || 0
  }
  
  const remaining = limitConfig.limit_value - currentUsage
  const allowed = remaining >= quantity
  
  return new Response(JSON.stringify({
    allowed, feature, current: currentUsage, limit: limitConfig.limit_value,
    remaining: Math.max(0, remaining), period: limitConfig.period, plan, upgrade_required: !allowed
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
