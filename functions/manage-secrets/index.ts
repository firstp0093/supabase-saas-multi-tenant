// =====================================================
// MANAGE EDGE FUNCTION SECRETS
// Add, update, delete secrets programmatically
// For AI-driven infrastructure management
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
}

const SUPABASE_PROJECT_REF = Deno.env.get('SUPABASE_URL')!.match(/https:\/\/([^.]+)/)?.[1]
const MANAGEMENT_API = 'https://api.supabase.com/v1'
const BASE_ACCESS_TOKEN = Deno.env.get('BASE_ACCESS_TOKEN')!  // Personal access token from supabase.com/dashboard/account/tokens
const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  
  // Require admin key
  const adminKey = req.headers.get('X-Admin-Key')
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized - Admin key required' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  const { action, secrets } = await req.json()
  
  const headers = {
    'Authorization': `Bearer ${BASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
  
  // ===== LIST SECRETS =====
  if (action === 'list') {
    try {
      const response = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/secrets`,
        { headers }
      )
      
      const secretsList = await response.json()
      
      // Only return names, not values (security)
      return new Response(JSON.stringify({
        success: true,
        secrets: secretsList.map((s: any) => ({
          name: s.name,
          // value is never returned for security
        })),
        count: secretsList.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== SET SECRETS (create or update) =====
  if (action === 'set') {
    if (!secrets || !Array.isArray(secrets) || secrets.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'secrets array required. Format: [{ name: "KEY", value: "value" }]' 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Validate format
    for (const secret of secrets) {
      if (!secret.name || !secret.value) {
        return new Response(JSON.stringify({ error: 'Each secret must have name and value' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      // Validate name format (uppercase with underscores)
      if (!/^[A-Z][A-Z0-9_]*$/.test(secret.name)) {
        return new Response(JSON.stringify({ 
          error: `Invalid secret name: ${secret.name}. Must be UPPERCASE_WITH_UNDERSCORES` 
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }
    
    // Prevent modifying critical secrets
    const protectedSecrets = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'BASE_ACCESS_TOKEN', 'ADMIN_KEY']
    const attemptedProtected = secrets.find((s: any) => protectedSecrets.includes(s.name))
    if (attemptedProtected) {
      return new Response(JSON.stringify({ 
        error: `Cannot modify protected secret: ${attemptedProtected.name}` 
      }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const response = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/secrets`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(secrets)
        }
      )
      
      if (!response.ok) {
        const error = await response.json()
        return new Response(JSON.stringify({ error: error.message || 'Failed to set secrets' }), {
          status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Log the action (without values)
      await supabase.from('activity_log').insert({
        action: 'secrets.updated',
        resource_type: 'edge_secrets',
        metadata: { secret_names: secrets.map((s: any) => s.name) }
      })
      
      return new Response(JSON.stringify({
        success: true,
        updated: secrets.map((s: any) => s.name)
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  // ===== DELETE SECRETS =====
  if (action === 'delete') {
    if (!secrets || !Array.isArray(secrets) || secrets.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'secrets array required. Format: ["SECRET_NAME"]' 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Prevent deleting critical secrets
    const protectedSecrets = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'BASE_ACCESS_TOKEN', 'ADMIN_KEY']
    const attemptedProtected = secrets.find((name: string) => protectedSecrets.includes(name))
    if (attemptedProtected) {
      return new Response(JSON.stringify({ 
        error: `Cannot delete protected secret: ${attemptedProtected}` 
      }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    try {
      const response = await fetch(
        `${MANAGEMENT_API}/projects/${SUPABASE_PROJECT_REF}/secrets`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify(secrets)  // Array of names to delete
        }
      )
      
      if (!response.ok) {
        const error = await response.json()
        return new Response(JSON.stringify({ error: error.message || 'Failed to delete secrets' }), {
          status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      // Log the action
      await supabase.from('activity_log').insert({
        action: 'secrets.deleted',
        resource_type: 'edge_secrets',
        metadata: { deleted: secrets }
      })
      
      return new Response(JSON.stringify({ success: true, deleted: secrets }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
  
  return new Response(JSON.stringify({ error: 'Invalid action. Use: list, set, delete' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
