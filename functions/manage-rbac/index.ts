// =====================================================
// MANAGE RBAC
// Role-based access control & custom permissions
// For AI-driven permission management
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

  const { action, role_name, permissions, user_id, tenant_id } = await req.json()

  // ===== LIST ROLES =====
  if (action === 'list_roles') {
    const { data, error } = await supabase
      .from('roles')
      .select('*')
      .order('name')

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ roles: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== CREATE ROLE =====
  if (action === 'create_role') {
    if (!role_name || !permissions) {
      return new Response(JSON.stringify({ error: 'role_name and permissions required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data, error } = await supabase
      .from('roles')
      .insert({
        name: role_name,
        permissions,
        is_system: false
      })
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true, role: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== UPDATE ROLE =====
  if (action === 'update_role') {
    if (!role_name) {
      return new Response(JSON.stringify({ error: 'role_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const updates: any = {}
    if (permissions) updates.permissions = permissions

    const { data, error } = await supabase
      .from('roles')
      .update(updates)
      .eq('name', role_name)
      .eq('is_system', false)
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true, role: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== DELETE ROLE =====
  if (action === 'delete_role') {
    if (!role_name) {
      return new Response(JSON.stringify({ error: 'role_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { error } = await supabase
      .from('roles')
      .delete()
      .eq('name', role_name)
      .eq('is_system', false)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== ASSIGN ROLE =====
  if (action === 'assign_role') {
    if (!user_id || !tenant_id || !role_name) {
      return new Response(JSON.stringify({ error: 'user_id, tenant_id, and role_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { error } = await supabase
      .from('user_tenants')
      .update({ role: role_name })
      .eq('user_id', user_id)
      .eq('tenant_id', tenant_id)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== GET USER ROLE =====
  if (action === 'get_user_role') {
    if (!user_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'user_id and tenant_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data, error } = await supabase
      .from('user_tenants')
      .select('role')
      .eq('user_id', user_id)
      .eq('tenant_id', tenant_id)
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ role: data?.role }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // ===== CHECK PERMISSION =====
  if (action === 'check_permission') {
    if (!user_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'user_id and tenant_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data } = await supabase
      .from('user_tenants')
      .select('role, roles(permissions)')
      .eq('user_id', user_id)
      .eq('tenant_id', tenant_id)
      .single()

    if (!data) {
      return new Response(JSON.stringify({ has_permission: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const roleData = data.roles as any
    return new Response(JSON.stringify({
      role: data.role,
      permissions: roleData?.permissions || []
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({
    error: 'Invalid action. Use: list_roles, create_role, update_role, delete_role, assign_role, get_user_role, check_permission'
  }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
