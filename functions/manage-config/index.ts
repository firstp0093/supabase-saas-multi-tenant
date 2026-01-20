// =====================================================
// MANAGE GLOBAL CONFIG
// Feature flags & global settings
// For AI-driven configuration management
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

  const { action, key, value, scope, tenant_id } = await req.json()

  // ===== GET CONFIG =====
  if (action === 'get') {
    const query = supabase
      .from('global_config')
      .select('*')

    if (key) query.eq('key', key)
    if (scope) query.eq('scope', scope)
    if (tenant_id) query.eq('tenant_id', tenant_id)

    const { data, error } = await query

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify(key ? data[0] : { config: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== SET CONFIG =====
  if (action === 'set') {
    if (!key || value === undefined) {
      return new Response(JSON.stringify({ error: 'key and value required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data, error } = await supabase
      .from('global_config')
      .upsert({
        key,
        value,
        scope: scope || 'global',
        tenant_id: scope === 'tenant' ? tenant_id : null
      }, { onConflict: 'key,scope,tenant_id' })
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true, config: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== DELETE CONFIG =====
  if (action === 'delete') {
    if (!key) {
      return new Response(JSON.stringify({ error: 'key required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const query = supabase
      .from('global_config')
      .delete()
      .eq('key', key)

    if (scope) query.eq('scope', scope)
    if (tenant_id) query.eq('tenant_id', tenant_id)

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

  // ===== TOGGLE FEATURE =====
  if (action === 'toggle_feature') {
    if (!key) {
      return new Response(JSON.stringify({ error: 'key (feature name) required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get current value
    const { data: current } = await supabase
      .from('global_config')
      .select('value')
      .eq('key', key)
      .eq('scope', scope || 'global')
      .single()

    const newValue = !current?.value

    const { data, error } = await supabase
      .from('global_config')
      .upsert({
        key,
        value: newValue,
        scope: scope || 'global',
        tenant_id: scope === 'tenant' ? tenant_id : null
      }, { onConflict: 'key,scope,tenant_id' })
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true, enabled: newValue }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== MAINTENANCE MODE =====
  if (action === 'maintenance_mode') {
    const enabled = value !== false

    const { error } = await supabase
      .from('global_config')
      .upsert({
        key: 'maintenance_mode',
        value: enabled,
        scope: 'global'
      }, { onConflict: 'key,scope' })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      success: true,
      maintenance_mode: enabled,
      message: enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({
    error: 'Invalid action. Use: get, set, delete, toggle_feature, maintenance_mode'
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
