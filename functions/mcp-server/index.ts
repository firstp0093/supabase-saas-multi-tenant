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
const ADMIN_KEY = Deno.env.get('ADMIN_KEY')!

// Tool definitions
const tools = [
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
      version: "2.0.0",
      description: "MCP server for Supabase SaaS infrastructure - build and manage SaaS applications",
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

      if (!name || !toolEndpoints[name]) {
        return new Response(JSON.stringify({ 
          error: `Unknown tool: ${name}`,
          available: Object.keys(toolEndpoints)
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
        
        if (!toolEndpoints[tool]) {
          return new Response(JSON.stringify({ 
            error: `Unknown tool: ${tool}`,
            available: Object.keys(toolEndpoints)
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
        version: "2.0.0",
        endpoints: {
          "GET /info": "Server info",
          "GET /tools": "List tools",
          "POST /call": "Call tool (MCP format)",
          "POST /": "Call tool (simple format: {tool, ...args})"
        },
        tools: Object.keys(toolEndpoints),
        categories: {
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
    version: "2.0.0",
    description: "Build and manage SaaS applications via MCP",
    endpoints: {
      "GET /info": "Server info",
      "GET /tools": "List available tools", 
      "POST /call": "Call a tool (MCP format: {name, arguments})",
      "POST /": "Call a tool (simple format: {tool, action, ...args})"
    },
    toolCount: tools.length,
    categories: {
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
