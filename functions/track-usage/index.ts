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
  
  let tenant_id: string | null = null
  let user_id: string | null = null
  
  const authHeader = req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (user) {
      user_id = user.id
      const { data: userTenant } = await supabase
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single()
      tenant_id = userTenant?.tenant_id
    }
  }
  
  const { feature, quantity = 1, metadata = {}, tenant_id: bodyTenantId } = await req.json()
  if (bodyTenantId) tenant_id = bodyTenantId
  
  if (!tenant_id) {
    return new Response(JSON.stringify({ error: 'No tenant found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Record event
  await supabase.from('usage_events').insert({ tenant_id, user_id, feature, quantity, metadata })
  
  // Update aggregated record
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  
  const { data: existing } = await supabase
    .from('usage_records')
    .select('id, value')
    .eq('tenant_id', tenant_id)
    .eq('feature', feature)
    .gte('period_start', periodStart.toISOString())
    .lte('period_end', periodEnd.toISOString())
    .single()
  
  if (existing) {
    await supabase.from('usage_records').update({ value: existing.value + quantity, updated_at: now.toISOString() }).eq('id', existing.id)
  } else {
    await supabase.from('usage_records').insert({
      tenant_id, feature, value: quantity,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString()
    })
  }
  
  return new Response(JSON.stringify({ success: true, feature, quantity, recorded_at: now.toISOString() }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
