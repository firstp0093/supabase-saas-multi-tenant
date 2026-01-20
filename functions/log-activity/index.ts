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
      
      if (userTenant) {
        await supabase.from('user_tenants')
          .update({ last_active_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('tenant_id', userTenant.tenant_id)
      }
    }
  }
  
  const { action, resource_type, resource_id, metadata = {}, tenant_id: bodyTenantId } = await req.json()
  if (bodyTenantId) tenant_id = bodyTenantId
  
  const clientIp = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0] || null
  const userAgent = req.headers.get('User-Agent')
  
  const { data: logEntry, error } = await supabase
    .from('activity_log')
    .insert({ tenant_id, user_id, action, resource_type, resource_id, metadata, ip_address: clientIp, user_agent: userAgent })
    .select('id, created_at')
    .single()
  
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  return new Response(JSON.stringify({ success: true, log_id: logEntry.id, logged_at: logEntry.created_at }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
