// =====================================================
// MANAGE VAULT SECRETS
// Store encrypted secrets per tenant/user
// Uses Supabase Vault (pgsodium)
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // Can be called with user auth OR admin key
  const authHeader = req.headers.get('Authorization')
  const adminKey = req.headers.get('X-Admin-Key')
  
  let userId: string | null = null
  let tenantId: string | null = null
  let isAdmin = false
  
  // Check admin key first
  if (adminKey && adminKey === Deno.env.get('ADMIN_KEY')) {
    isAdmin = true
  } else if (authHeader?.startsWith('Bearer ')) {
    const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (error || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    userId = user.id
    
    // Get tenant
    const { data: userTenant } = await supabase
      .from('user_tenants')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .single()
    
    tenantId = userTenant?.tenant_id
    isAdmin = ['owner', 'admin'].includes(userTenant?.role)
  } else {
    return new Response(JSON.stringify({ error: 'Authorization required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const { action, secret_name, secret_value, description, scope, secret_id } = await req.json()
  
  // ===== LIST SECRETS =====
  if (action === 'list') {
    try {
      // Query vault.secrets view (decrypted)
      let query = supabase
        .from('tenant_secrets')
        .select('id, name, description, scope, created_at, updated_at')
      
      if (!isAdmin && tenantId) {
        // Regular users only see their tenant's secrets
        query = query.eq('tenant_id', tenantId)
      }
      
      const { data: secrets, error } = await query.order('name')
      
      if (error) {
        // Fallback: try vault directly
        const result = await executeSql(supabase, `
          SELECT id, name, description, created_at, updated_at
          FROM vault.secrets
          ORDER BY name
        `)
        return new Response(JSON.stringify({ success: true, secrets: result }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        secrets,
        count: secrets?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== GET SECRET VALUE =====
  if (action === 'get') {
    if (!secret_name && !secret_id) {
      return new Response(JSON.stringify({ error: 'secret_name or secret_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      let query = supabase
        .from('tenant_secrets')
        .select('*')
      
      if (secret_id) {
        query = query.eq('id', secret_id)
      } else {
        query = query.eq('name', secret_name)
      }
      
      if (!isAdmin && tenantId) {
        query = query.eq('tenant_id', tenantId)
      }
      
      const { data: secret, error } = await query.single()
      
      if (error || !secret) {
        return new Response(JSON.stringify({ error: 'Secret not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Get decrypted value from vault
      const result = await executeSql(supabase, `
        SELECT decrypted_secret 
        FROM vault.decrypted_secrets 
        WHERE id = '${secret.vault_secret_id}'
      `)
      
      return new Response(JSON.stringify({ 
        success: true,
        secret: {
          id: secret.id,
          name: secret.name,
          value: result?.[0]?.decrypted_secret,
          description: secret.description,
          scope: secret.scope
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
  
  // ===== CREATE SECRET =====
  if (action === 'create' || action === 'set') {
    if (!secret_name || !secret_value) {
      return new Response(JSON.stringify({ 
        error: 'secret_name and secret_value required',
        example: {
          secret_name: 'OPENAI_API_KEY',
          secret_value: 'sk-...',
          description: 'OpenAI API key for this tenant',
          scope: 'tenant'  // 'tenant', 'user', or 'global'
        }
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Only admins can create global secrets
    const secretScope = scope || 'tenant'
    if (secretScope === 'global' && !isAdmin) {
      return new Response(JSON.stringify({ error: 'Only admins can create global secrets' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Insert into vault.secrets
      const vaultResult = await executeSql(supabase, `
        INSERT INTO vault.secrets (name, secret, description)
        VALUES (
          '${tenantId ? `${tenantId}:${secret_name}` : secret_name}',
          '${secret_value}',
          '${description || ''}'
        )
        RETURNING id
      `)
      
      const vaultSecretId = vaultResult?.[0]?.id
      
      // Create our tracking record
      const { data: secretRecord, error } = await supabase
        .from('tenant_secrets')
        .upsert({
          tenant_id: tenantId,
          user_id: secretScope === 'user' ? userId : null,
          name: secret_name,
          description,
          scope: secretScope,
          vault_secret_id: vaultSecretId
        }, { onConflict: 'tenant_id,name' })
        .select()
        .single()
      
      // Log
      await supabase.from('activity_log').insert({
        tenant_id: tenantId,
        user_id: userId,
        action: 'vault.secret_created',
        resource_type: 'vault_secret',
        resource_id: secretRecord?.id,
        metadata: { secret_name, scope: secretScope }
      })
      
      return new Response(JSON.stringify({
        success: true,
        secret_id: secretRecord?.id,
        secret_name,
        scope: secretScope
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== UPDATE SECRET =====
  if (action === 'update') {
    if (!secret_name && !secret_id) {
      return new Response(JSON.stringify({ error: 'secret_name or secret_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Find the secret
      let query = supabase.from('tenant_secrets').select('*')
      if (secret_id) {
        query = query.eq('id', secret_id)
      } else {
        query = query.eq('name', secret_name)
      }
      if (!isAdmin && tenantId) {
        query = query.eq('tenant_id', tenantId)
      }
      
      const { data: existing, error: findError } = await query.single()
      
      if (findError || !existing) {
        return new Response(JSON.stringify({ error: 'Secret not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Update in vault if value provided
      if (secret_value) {
        await executeSql(supabase, `
          UPDATE vault.secrets 
          SET secret = '${secret_value}', updated_at = now()
          WHERE id = '${existing.vault_secret_id}'
        `)
      }
      
      // Update description if provided
      if (description !== undefined) {
        await supabase
          .from('tenant_secrets')
          .update({ description, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      }
      
      // Log
      await supabase.from('activity_log').insert({
        tenant_id: tenantId,
        user_id: userId,
        action: 'vault.secret_updated',
        resource_type: 'vault_secret',
        resource_id: existing.id,
        metadata: { secret_name: existing.name }
      })
      
      return new Response(JSON.stringify({ success: true, updated: existing.name }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== DELETE SECRET =====
  if (action === 'delete') {
    if (!secret_name && !secret_id) {
      return new Response(JSON.stringify({ error: 'secret_name or secret_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      // Find the secret
      let query = supabase.from('tenant_secrets').select('*')
      if (secret_id) {
        query = query.eq('id', secret_id)
      } else {
        query = query.eq('name', secret_name)
      }
      if (!isAdmin && tenantId) {
        query = query.eq('tenant_id', tenantId)
      }
      
      const { data: existing, error: findError } = await query.single()
      
      if (findError || !existing) {
        return new Response(JSON.stringify({ error: 'Secret not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Delete from vault
      await executeSql(supabase, `
        DELETE FROM vault.secrets WHERE id = '${existing.vault_secret_id}'
      `)
      
      // Delete our tracking record
      await supabase.from('tenant_secrets').delete().eq('id', existing.id)
      
      // Log
      await supabase.from('activity_log').insert({
        tenant_id: tenantId,
        user_id: userId,
        action: 'vault.secret_deleted',
        resource_type: 'vault_secret',
        metadata: { secret_name: existing.name }
      })
      
      return new Response(JSON.stringify({ success: true, deleted: existing.name }), {
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
    available: ['list', 'get', 'create', 'set', 'update', 'delete']
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})

async function executeSql(supabase: any, sql: string): Promise<any> {
  const { data, error } = await supabase.rpc('exec_sql', { query: sql })
  if (error) throw new Error(`SQL Error: ${error.message}`)
  return data
}
