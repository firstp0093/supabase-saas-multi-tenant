import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new TextDecoder().decode(hexEncode(new Uint8Array(hashBuffer)))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const authHeader = req.headers.get('Authorization')!
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { data: userTenant } = await supabase
    .from('user_tenants')
    .select('tenant_id, role, tenants(slug)')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()
  
  if (!userTenant || !['owner', 'admin'].includes(userTenant.role)) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { name, scopes = ['read'], expires_in_days } = await req.json()
  
  if (!name || name.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Name is required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  // Generate key
  const randomPart = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const fullKey = `pk_${userTenant.tenants.slug}_${randomPart}`
  const keyPrefix = fullKey.substring(0, 20) + '...'
  const keyHash = await hashKey(fullKey)
  
  const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString() : null
  
  const { data: apiKey, error: createError } = await supabase
    .from('api_keys')
    .insert({
      tenant_id: userTenant.tenant_id,
      name, key_prefix: keyPrefix, key_hash: keyHash,
      scopes, expires_at: expiresAt, created_by: user.id
    })
    .select('id, name, key_prefix, scopes, expires_at, created_at')
    .single()
  
  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  await supabase.from('activity_log').insert({
    tenant_id: userTenant.tenant_id, user_id: user.id,
    action: 'api_key.created', resource_type: 'api_key', resource_id: apiKey.id,
    metadata: { name, scopes }
  })
  
  return new Response(JSON.stringify({
    success: true,
    api_key: { ...apiKey, key: fullKey },
    warning: 'Save this key now. It cannot be retrieved again.'
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
