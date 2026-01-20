// =====================================================
// MCP SERVER - HTTP Endpoint
// Exposes all Edge Functions as MCP tools via HTTP
// Compatible with MCP SSE transport
// =====================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!
const SITE_URL = Deno.env.get('SITE_URL') || 'http://localhost:3000'

// Tool definitions
const tools = [
  // ===== AUTHENTICATION TOOLS =====
  {
    name: "auth_sign_up",
    description: "Create a new user account",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "User email address" },
        password: { type: "string", description: "User password (min 6 chars)" },
        metadata: { type: "object", description: "Optional user metadata" }
      },
      required: ["email", "password"]
    }
  },
  {
    name: "auth_sign_in",
    description: "Sign in and get session tokens",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "User email address" },
        password: { type: "string", description: "User password" }
      },
      required: ["email", "password"]
    }
  },
  {
    name: "auth_sign_out",
    description: "Sign out and invalidate session",
    inputSchema: {
      type: "object",
      properties: {
        access_token: { type: "string", description: "Current access token" }
      },
      required: ["access_token"]
    }
  },
  {
    name: "auth_get_user",
    description: "Get current user details from access token",
    inputSchema: {
      type: "object",
      properties: {
        access_token: { type: "string", description: "User's access token" }
      },
      required: ["access_token"]
    }
  },
  {
    name: "auth_refresh_token",
    description: "Refresh an expired access token",
    inputSchema: {
      type: "object",
      properties: {
        refresh_token: { type: "string", description: "Refresh token from sign-in" }
      },
      required: ["refresh_token"]
    }
  },
  {
    name: "auth_reset_password",
    description: "Send password reset email",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address" }
      },
      required: ["email"]
    }
  },
  {
    name: "auth_update_password",
    description: "Update user password",
    inputSchema: {
      type: "object",
      properties: {
        access_token: { type: "string", description: "User's access token" },
        new_password: { type: "string", description: "New password (min 6 chars)" }
      },
      required: ["access_token", "new_password"]
    }
  },
  {
    name: "auth_sign_up_with_tenant",
    description: "Create user account AND provision tenant in one call",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "User email address" },
        password: { type: "string", description: "User password (min 6 chars)" },
        tenant_name: { type: "string", description: "Organization/company name" },
        tenant_slug: { type: "string", description: "URL-friendly slug (optional)" },
        user_metadata: { type: "object", description: "Optional user metadata" }
      },
      required: ["email", "password", "tenant_name"]
    }
  },

  // ===== INFRASTRUCTURE TOOLS =====
  {
    name: "manage_database",
    description: "List tables, create tables, add columns, run SQL queries",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_tables", "describe", "create_table", "add_column", "create_index", "run_sql", "drop_table"] },
        table_name: { type: "string" },
        columns: { type: "array" },
        sql: { type: "string" },
        enable_rls: { type: "boolean" },
        tenant_isolated: { type: "boolean" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_functions",
    description: "List, create, update, or delete Edge Functions",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "invoke"] },
        function_name: { type: "string" },
        function_code: { type: "string" },
        verify_jwt: { type: "boolean" },
        payload: { type: "object" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_secrets",
    description: "List, set, or delete Edge Function secrets",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set", "delete"] },
        secrets: { type: "array" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_cron",
    description: "List, create, update, delete scheduled cron jobs",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "run_now", "history"] },
        job_name: { type: "string" },
        schedule: { type: "string" },
        command: { type: "string" },
        active: { type: "boolean" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_vault",
    description: "Securely store and retrieve encrypted secrets per tenant/user",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "set", "update", "delete"] },
        secret_name: { type: "string" },
        secret_value: { type: "string" },
        description: { type: "string" },
        scope: { type: "string", enum: ["global", "tenant", "user"] }
      },
      required: ["action"]
    }
  },

  // ===== RBAC & CONFIG TOOLS =====
  {
    name: "manage_rbac",
    description: "Manage roles and permissions - list, create, update, delete roles; assign roles to users",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_roles", "create_role", "update_role", "delete_role", "assign_role", "get_user_role", "check_permission"] },
        role_name: { type: "string" },
        permissions: { type: "array", items: { type: "string" } },
        user_id: { type: "string" },
        tenant_id: { type: "string" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_config",
    description: "Manage feature flags and configuration settings globally or per-tenant",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set", "delete", "list", "maintenance_mode"] },
        key: { type: "string" },
        value: { type: "any" },
        scope: { type: "string", enum: ["global", "tenant"] },
        tenant_id: { type: "string" },
        enabled: { type: "boolean" }
      },
      required: ["action"]
    }
  },

  // ===== BILLING TOOLS =====
  {
    name: "manage_billing",
    description: "Manage subscriptions and one-time product purchases via Stripe",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [
          "get_status", "change_plan", "cancel", "reactivate", "update_payment_method", "get_invoices",
          "create_product", "update_product", "archive_product", "list_products",
          "purchase_product", "get_purchases", "verify_purchase"
        ]},
        plan: { type: "string", enum: ["starter", "pro", "enterprise"] },
        payment_method_id: { type: "string" },
        product_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        price: { type: "number" },
        currency: { type: "string" },
        success_url: { type: "string" },
        cancel_url: { type: "string" },
        session_id: { type: "string" }
      },
      required: ["action"]
    }
  },

  // ===== ANALYTICS TOOLS =====
  {
    name: "get_analytics",
    description: "Get usage reports, activity logs, and metrics",
    inputSchema: {
      type: "object",
      properties: {
        report: { type: "string", enum: ["dashboard", "usage", "activity", "tenant_summary"] },
        tenant_id: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        limit: { type: "number" }
      },
      required: ["report"]
    }
  },

  // ===== TENANT & TEAM TOOLS =====
  {
    name: "provision_tenant",
    description: "Create a new tenant/organization with optional Stripe customer",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        plan: { type: "string", enum: ["free", "starter", "pro", "enterprise"] },
        owner_email: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "invite_team_member",
    description: "Send team invitation email to add users to a tenant",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        role: { type: "string", enum: ["admin", "member", "viewer"] },
        message: { type: "string" }
      },
      required: ["email", "role"]
    }
  },

  // ===== DOMAIN & SERVICES =====
  {
    name: "manage_domain",
    description: "Add, verify, update, or delete custom email/web domains",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "verify", "set_primary", "update_email", "delete"] },
        domain: { type: "string" },
        domain_id: { type: "string" },
        email_from_name: { type: "string" },
        email_from_address: { type: "string" }
      },
      required: ["action"]
    }
  },
  {
    name: "discover_services",
    description: "List available microservices and their capabilities",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        enabled_only: { type: "boolean" }
      }
    }
  },
  {
    name: "check_service_health",
    description: "Check health status of services",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string" }
      }
    }
  },

  // ===== SUB-SAAS BUILDER TOOLS =====
  {
    name: "create_sub_saas",
    description: "Create a new sub-SaaS application for a tenant (B2B2C). Sets up isolated schema, auth, and optional Stripe Connect.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the sub-SaaS app" },
        slug: { type: "string", description: "URL-friendly identifier" },
        template: { type: "string", enum: ["blank", "crm", "booking", "ecommerce", "helpdesk", "membership"] },
        enable_stripe_connect: { type: "boolean", description: "Enable payments for sub-SaaS users" },
        custom_domain: { type: "string" }
      },
      required: ["name", "slug"]
    }
  },
  {
    name: "manage_sub_saas",
    description: "Manage existing sub-SaaS applications - list, update settings, manage users, view metrics",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "update", "delete", "list_users", "add_user", "remove_user", "get_metrics"] },
        sub_saas_id: { type: "string" },
        settings: { type: "object" },
        user_email: { type: "string" },
        user_role: { type: "string" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_stripe_connect",
    description: "Manage Stripe Connect for sub-SaaS - onboard accounts, create payment links, view payouts",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_account", "get_onboarding_link", "get_dashboard_link", "create_payment_link", "list_payments", "get_balance"] },
        sub_saas_id: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        description: { type: "string" },
        return_url: { type: "string" }
      },
      required: ["action", "sub_saas_id"]
    }
  }
]

// Map tool names to Edge Function endpoints
const toolEndpoints: Record<string, string> = {
  // Infrastructure
  manage_database: "manage-database",
  manage_functions: "manage-functions",
  manage_secrets: "manage-secrets",
  manage_cron: "manage-cron",
  manage_vault: "manage-vault",
  // RBAC & Config
  manage_rbac: "manage-rbac",
  manage_config: "manage-config",
  // Billing
  manage_billing: "manage-billing",
  // Analytics
  get_analytics: "get-analytics",
  // Tenant & Team
  provision_tenant: "provision-tenant",
  invite_team_member: "invite-team-member",
  // Domain & Services
  manage_domain: "manage-domain",
  discover_services: "discover-services",
  check_service_health: "check-service-health",
  // Sub-SaaS Builder
  create_sub_saas: "create-sub-saas",
  manage_sub_saas: "manage-sub-saas",
  manage_stripe_connect: "manage-stripe-connect",
}

// Auth tools handled directly (not via Edge Functions)
const authTools = [
  "auth_sign_up",
  "auth_sign_in", 
  "auth_sign_out",
  "auth_get_user",
  "auth_refresh_token",
  "auth_reset_password",
  "auth_update_password",
  "auth_sign_up_with_tenant"
]

// Admin-only tools
const adminTools = [
  "manage_database", 
  "manage_functions", 
  "manage_secrets", 
  "manage_cron",
  "manage_rbac",
  "manage_config",
  "get_analytics",
  "create_sub_saas",
  "manage_stripe_connect"
]

// =====================================================
// AUTH HANDLERS
// =====================================================

async function handleAuthSignUp(args: Record<string, unknown>) {
  const { email, password, metadata } = args as { 
    email: string
    password: string
    metadata?: Record<string, unknown>
  }

  const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata || {},
    }),
  })

  const userData = await createResponse.json()
  
  if (!createResponse.ok) {
    throw new Error(userData.message || userData.error || "Failed to create user")
  }

  const signInResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  })

  const session = await signInResponse.json()

  return {
    user: userData,
    session: signInResponse.ok ? session : null,
    access_token: session?.access_token,
    refresh_token: session?.refresh_token,
    message: "User created successfully",
  }
}

async function handleAuthSignIn(args: Record<string, unknown>) {
  const { email, password } = args as { email: string; password: string }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  })

  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Sign in failed")
  }

  return {
    user: data.user,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: data.expires_at,
  }
}

async function handleAuthSignOut(args: Record<string, unknown>) {
  const { access_token } = args as { access_token: string }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${access_token}`,
    },
  })

  if (!response.ok && response.status !== 204) {
    const data = await response.json()
    throw new Error(data.error || "Sign out failed")
  }

  return { message: "Signed out successfully" }
}

async function handleAuthGetUser(args: Record<string, unknown>) {
  const { access_token } = args as { access_token: string }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${access_token}`,
    },
  })

  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data.error || "Failed to get user")
  }

  return { user: data }
}

async function handleAuthRefreshToken(args: Record<string, unknown>) {
  const { refresh_token } = args as { refresh_token: string }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token }),
  })

  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Token refresh failed")
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: data.expires_at,
  }
}

async function handleAuthResetPassword(args: Record<string, unknown>) {
  const { email } = args as { email: string }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ 
      email,
      redirect_to: `${SITE_URL}/reset-password`,
    }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || "Password reset failed")
  }

  return { message: "Password reset email sent" }
}

async function handleAuthUpdatePassword(args: Record<string, unknown>) {
  const { access_token, new_password } = args as { 
    access_token: string
    new_password: string
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${access_token}`,
    },
    body: JSON.stringify({ password: new_password }),
  })

  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data.error || "Password update failed")
  }

  return { message: "Password updated successfully", user: data }
}

async function handleAuthSignUpWithTenant(args: Record<string, unknown>) {
  const { email, password, tenant_name, tenant_slug, user_metadata } = args as {
    email: string
    password: string
    tenant_name: string
    tenant_slug?: string
    user_metadata?: Record<string, unknown>
  }

  // 1. Create user
  const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: user_metadata || {},
    }),
  })

  const userData = await createResponse.json()
  
  if (!createResponse.ok) {
    throw new Error(userData.message || userData.error || "Failed to create user")
  }

  // 2. Sign in
  const signInResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  })

  const session = await signInResponse.json()
  
  if (!signInResponse.ok) {
    throw new Error(session.error || "Failed to sign in")
  }

  // 3. Create tenant
  const slug = tenant_slug || tenant_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  
  const tenantResponse = await fetch(`${SUPABASE_URL}/rest/v1/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      name: tenant_name,
      slug: slug,
      plan: "free",
    }),
  })

  const tenantData = await tenantResponse.json()
  
  if (!tenantResponse.ok) {
    throw new Error(tenantData.message || "Failed to create tenant")
  }

  const tenant = Array.isArray(tenantData) ? tenantData[0] : tenantData

  // 4. Link user to tenant
  const linkResponse = await fetch(`${SUPABASE_URL}/rest/v1/user_tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      user_id: userData.id,
      tenant_id: tenant.id,
      role: "owner",
      is_default: true,
    }),
  })

  if (!linkResponse.ok) {
    const linkError = await linkResponse.json()
    throw new Error(linkError.message || "Failed to link user to tenant")
  }

  return {
    user: userData,
    tenant: tenant,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    message: "Account and tenant created successfully",
  }
}

// Route auth tool calls
async function handleAuthTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "auth_sign_up": return handleAuthSignUp(args)
    case "auth_sign_in": return handleAuthSignIn(args)
    case "auth_sign_out": return handleAuthSignOut(args)
    case "auth_get_user": return handleAuthGetUser(args)
    case "auth_refresh_token": return handleAuthRefreshToken(args)
    case "auth_reset_password": return handleAuthResetPassword(args)
    case "auth_update_password": return handleAuthUpdatePassword(args)
    case "auth_sign_up_with_tenant": return handleAuthSignUpWithTenant(args)
    default: throw new Error(`Unknown auth tool: ${name}`)
  }
}

// =====================================================
// MAIN SERVER
// =====================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  
  // Get auth from header
  const adminKey = req.headers.get('X-Admin-Key')
  const authHeader = req.headers.get('Authorization')

  // ===== MCP Protocol Endpoints =====
  
  // GET /mcp/info - Server info
  if (req.method === 'GET' && url.pathname.endsWith('/info')) {
    return new Response(JSON.stringify({
      name: "supabase-saas-mcp",
      version: "2.1.0",
      description: "MCP server for Supabase SaaS infrastructure with auth support",
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      },
      toolCount: tools.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // GET /mcp/tools - List available tools
  if (req.method === 'GET' && url.pathname.endsWith('/tools')) {
    return new Response(JSON.stringify({ tools }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // POST /mcp/call - Call a tool
  if (req.method === 'POST' && url.pathname.endsWith('/call')) {
    try {
      const { name, arguments: args } = await req.json()

      // Check if it's an auth tool
      if (authTools.includes(name)) {
        const result = await handleAuthTool(name, args || {})
        return new Response(JSON.stringify({
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (!name || !toolEndpoints[name]) {
        return new Response(JSON.stringify({ 
          error: `Unknown tool: ${name}`,
          available: [...authTools, ...Object.keys(toolEndpoints)]
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check admin auth for admin tools
      if (adminTools.includes(name)) {
        if (!adminKey || adminKey !== ADMIN_KEY) {
          return new Response(JSON.stringify({ error: 'Admin key required for this tool' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
      }

      // Call the actual Edge Function
      const endpoint = toolEndpoints[name]
      const functionUrl = `${SUPABASE_URL}/functions/v1/${endpoint}`
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      
      if (adminKey) headers['X-Admin-Key'] = adminKey
      if (authHeader) headers['Authorization'] = authHeader

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(args || {})
      })

      const result = await response.json()

      return new Response(JSON.stringify({
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({
        content: [{
          type: "text", 
          text: `Error: ${error.message}`
        }],
        isError: true
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // ===== Simple REST API (for easy testing) =====
  
  // POST / - Direct tool call (simpler format)
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      
      // If it's a simple {tool, ...args} format
      if (body.tool) {
        const { tool, ...args } = body

        // Handle auth tools
        if (authTools.includes(tool)) {
          const result = await handleAuthTool(tool, args)
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }
        
        if (!toolEndpoints[tool]) {
          return new Response(JSON.stringify({ 
            error: `Unknown tool: ${tool}`,
            available: [...authTools, ...Object.keys(toolEndpoints)]
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        // Check admin auth
        if (adminTools.includes(tool) && (!adminKey || adminKey !== ADMIN_KEY)) {
          return new Response(JSON.stringify({ error: 'Admin key required' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const endpoint = toolEndpoints[tool]
        const functionUrl = `${SUPABASE_URL}/functions/v1/${endpoint}`
        
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (adminKey) headers['X-Admin-Key'] = adminKey
        if (authHeader) headers['Authorization'] = authHeader

        const response = await fetch(functionUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(args)
        })

        const result = await response.json()
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Default: list tools
      return new Response(JSON.stringify({ 
        message: "MCP Server ready",
        version: "2.1.0",
        endpoints: {
          "GET /info": "Server info",
          "GET /tools": "List tools",
          "POST /call": "Call tool (MCP format)",
          "POST /": "Call tool (simple format: {tool, ...args})"
        },
        tools: [...authTools, ...Object.keys(toolEndpoints)],
        categories: {
          authentication: authTools,
          infrastructure: ["manage_database", "manage_functions", "manage_secrets", "manage_cron", "manage_vault"],
          rbac_config: ["manage_rbac", "manage_config"],
          billing: ["manage_billing"],
          analytics: ["get_analytics"],
          tenant_team: ["provision_tenant", "invite_team_member"],
          domains_services: ["manage_domain", "discover_services", "check_service_health"],
          sub_saas_builder: ["create_sub_saas", "manage_sub_saas", "manage_stripe_connect"]
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }

  // GET / - Welcome
  return new Response(JSON.stringify({
    name: "supabase-saas-mcp",
    version: "2.1.0",
    description: "Build and manage SaaS applications via MCP (with auth support)",
    endpoints: {
      "GET /info": "Server info",
      "GET /tools": "List available tools", 
      "POST /call": "Call a tool (MCP format: {name, arguments})",
      "POST /": "Call a tool (simple format: {tool, action, ...args})"
    },
    toolCount: tools.length,
    categories: {
      authentication: authTools,
      infrastructure: ["manage_database", "manage_functions", "manage_secrets", "manage_cron", "manage_vault"],
      rbac_config: ["manage_rbac", "manage_config"],
      billing: ["manage_billing"],
      analytics: ["get_analytics"],
      tenant_team: ["provision_tenant", "invite_team_member"],
      domains_services: ["manage_domain", "discover_services", "check_service_health"],
      sub_saas_builder: ["create_sub_saas", "manage_sub_saas", "manage_stripe_connect"]
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
