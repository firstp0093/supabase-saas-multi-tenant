import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
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
  
  let apiKey = req.headers.get('X-API-Key')
  
  if (!apiKey && req.method === 'POST') {
    const body = await req.json()
    apiKey = body.api_key
  }
  
  if (!apiKey) {
    return new Response(JSON.stringify({ valid: false, error: 'No API key provided' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const keyHash = await hashKey(apiKey)
  
  const { data: keyRecord, error } = await supabase
    .from('api_keys')
    .select('*, tenants(id, name, slug, plan)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()
  
  if (error || !keyRecord) {
    return new Response(JSON.stringify({ valid: false, error: 'Invalid API key' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return new Response(JSON.stringify({ valid: false, error: 'API key has expired' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const clientIp = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0] || 'unknown'
  
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString(), last_used_ip: clientIp }).eq('id', keyRecord.id)
  
  const url = new URL(req.url)
  await supabase.from('api_request_log').insert({
    tenant_id: keyRecord.tenant_id, api_key_id: keyRecord.id,
    endpoint: url.pathname, method: req.method, status_code: 200,
    ip_address: clientIp, user_agent: req.headers.get('User-Agent')
  })
  
  return new Response(JSON.stringify({
    valid: true, key_id: keyRecord.id, key_name: keyRecord.name, scopes: keyRecord.scopes,
    tenant: { id: keyRecord.tenants.id, name: keyRecord.tenants.name, slug: keyRecord.tenants.slug, plan: keyRecord.tenants.plan }
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
