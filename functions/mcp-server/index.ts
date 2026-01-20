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
  {
    name: "manage_database",
    description: "List tables, create tables, add columns, run SQL",
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
        action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
        function_name: { type: "string" },
        function_code: { type: "string" },
        verify_jwt: { type: "boolean" }
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
    description: "List, create, update, delete cron jobs",
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
    description: "List, get, create, update, delete encrypted tenant secrets",
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
  {
    name: "manage_domain",
    description: "Add, verify, update, or delete custom email domains",
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
    name: "provision_tenant",
    description: "Create a new tenant/organization",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        plan: { type: "string", enum: ["free", "starter", "pro", "enterprise"] }
      },
      required: ["name"]
    }
  },
  {
    name: "invite_team_member",
    description: "Send team invitation email",
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
  {
    name: "discover_services",
    description: "List available services",
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
  }
]

// Map tool names to Edge Function endpoints
const toolEndpoints: Record<string, string> = {
  manage_database: "manage-database",
  manage_functions: "manage-functions",
  manage_secrets: "manage-secrets",
  manage_cron: "manage-cron",
  manage_vault: "manage-vault",
  manage_domain: "manage-domain",
  provision_tenant: "provision-tenant",
  invite_team_member: "invite-team-member",
  discover_services: "discover-services",
  check_service_health: "check-service-health",
}

// Admin-only tools
const adminTools = ["manage_database", "manage_functions", "manage_secrets", "manage_cron"]

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
      version: "1.0.0",
      description: "MCP server for Supabase SaaS infrastructure management",
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      }
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
        endpoints: {
          "GET /info": "Server info",
          "GET /tools": "List tools",
          "POST /call": "Call tool (MCP format)",
          "POST /": "Call tool (simple format: {tool, ...args})"
        },
        tools: Object.keys(toolEndpoints)
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
    version: "1.0.0",
    endpoints: {
      "GET /info": "Server info",
      "GET /tools": "List available tools", 
      "POST /call": "Call a tool (MCP format: {name, arguments})",
      "POST /": "Call a tool (simple format: {tool, action, ...args})"
    },
    example: {
      simple: { tool: "manage_database", action: "list_tables" },
      mcp: { name: "manage_database", arguments: { action: "list_tables" } }
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
