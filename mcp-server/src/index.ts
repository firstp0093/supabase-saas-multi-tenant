#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Configuration from environment
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const ADMIN_KEY = process.env.ADMIN_KEY!;
const USER_TOKEN = process.env.SUPABASE_USER_TOKEN; // Optional: for user-scoped operations

// =====================================================
// TOOL DEFINITIONS
// =====================================================

const tools: Tool[] = [
  // ===== TENANT & TEAM =====
  {
    name: "provision_tenant",
    description: "Create a new tenant/organization with Stripe customer",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tenant/organization name" },
        plan: { type: "string", enum: ["free", "starter", "pro", "enterprise"], description: "Initial plan" }
      },
      required: ["name"]
    }
  },
  {
    name: "invite_team_member",
    description: "Send an email invitation to join a tenant",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address to invite" },
        role: { type: "string", enum: ["admin", "member", "viewer"], description: "Role to assign" },
        message: { type: "string", description: "Optional personal message" }
      },
      required: ["email", "role"]
    }
  },
  {
    name: "accept_invite",
    description: "Accept a team invitation using the invite token",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Invite token from the invitation URL" }
      },
      required: ["token"]
    }
  },

  // ===== DOMAIN & EMAIL =====
  {
    name: "manage_domain",
    description: "Add, verify, update, or delete custom domains for email sending",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "verify", "set_primary", "update_email", "delete"] },
        domain: { type: "string", description: "Domain name (for add)" },
        domain_id: { type: "string", description: "Domain UUID (for verify/update/delete)" },
        email_from_name: { type: "string", description: "Sender name (for update_email)" },
        email_from_address: { type: "string", description: "Sender address prefix (for update_email)" }
      },
      required: ["action"]
    }
  },

  // ===== BILLING =====
  {
    name: "create_checkout",
    description: "Create a Stripe checkout session for subscription",
    inputSchema: {
      type: "object",
      properties: {
        price_id: { type: "string", description: "Stripe price ID" },
        success_url: { type: "string", description: "URL to redirect after success" },
        cancel_url: { type: "string", description: "URL to redirect after cancel" }
      },
      required: ["price_id"]
    }
  },
  {
    name: "customer_portal",
    description: "Get Stripe customer portal URL for billing management",
    inputSchema: {
      type: "object",
      properties: {
        return_url: { type: "string", description: "URL to return to after portal" }
      }
    }
  },
  {
    name: "check_usage_limits",
    description: "Check if a feature is within plan limits",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature to check (pages, deployments, team_members, etc.)" },
        increment: { type: "number", description: "Amount to check against limit" }
      },
      required: ["feature"]
    }
  },
  {
    name: "track_usage",
    description: "Record a usage event for billing/limits",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature being used" },
        quantity: { type: "number", description: "Usage quantity" },
        metadata: { type: "object", description: "Additional context" }
      },
      required: ["feature", "quantity"]
    }
  },

  // ===== DEPLOYMENT =====
  {
    name: "setup_page",
    description: "Get injectable code snippets for a landing page",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Page UUID" }
      },
      required: ["page_id"]
    }
  },
  {
    name: "deploy_page",
    description: "Deploy a page to Cloudflare Pages",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Page UUID" },
        html: { type: "string", description: "HTML content to deploy" },
        subdomain: { type: "string", description: "Desired subdomain" }
      },
      required: ["page_id", "html"]
    }
  },

  // ===== SERVICES =====
  {
    name: "discover_services",
    description: "List available services and their status",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category" },
        enabled_only: { type: "boolean", description: "Only show enabled services" }
      }
    }
  },
  {
    name: "configure_service",
    description: "Enable or configure a service for the tenant",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Service UUID" },
        enabled: { type: "boolean", description: "Enable/disable" },
        config: { type: "object", description: "Service configuration" }
      },
      required: ["service_id"]
    }
  },
  {
    name: "check_service_health",
    description: "Check health status of services",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Specific service to check (optional)" }
      }
    }
  },

  // ===== API KEYS =====
  {
    name: "create_api_key",
    description: "Generate a new API key for programmatic access",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Key name/description" },
        scopes: { type: "array", items: { type: "string" }, description: "Permitted scopes" },
        expires_in_days: { type: "number", description: "Days until expiration" }
      },
      required: ["name"]
    }
  },
  {
    name: "validate_api_key",
    description: "Validate an API key and get its details",
    inputSchema: {
      type: "object",
      properties: {
        api_key: { type: "string", description: "The API key to validate" }
      },
      required: ["api_key"]
    }
  },

  // ===== INFRASTRUCTURE (Admin) =====
  {
    name: "manage_functions",
    description: "List, create, update, or delete Edge Functions (admin only)",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete"] },
        function_name: { type: "string", description: "Function name (slug format)" },
        function_code: { type: "string", description: "TypeScript code for the function" },
        verify_jwt: { type: "boolean", description: "Require JWT auth (default: true)" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_secrets",
    description: "List, set, or delete Edge Function environment secrets (admin only)",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "set", "delete"] },
        secrets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string" }
            }
          },
          description: "Secrets to set or delete"
        }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_database",
    description: "List tables, create tables, add columns, run SQL (admin only)",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_tables", "describe", "create_table", "add_column", "create_index", "run_sql", "drop_table"] },
        table_name: { type: "string", description: "Table name" },
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              primary: { type: "boolean" },
              nullable: { type: "boolean" },
              default: { type: "string" },
              references: { type: "string" }
            }
          },
          description: "Column definitions"
        },
        sql: { type: "string", description: "Raw SQL to execute" },
        enable_rls: { type: "boolean", description: "Enable RLS on new table" },
        tenant_isolated: { type: "boolean", description: "Add tenant isolation policy" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_cron",
    description: "List, create, update, delete, or run cron jobs (admin only)",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "run_now", "history"] },
        job_name: { type: "string", description: "Job name" },
        schedule: { type: "string", description: "Cron schedule (e.g., '0 3 * * *')" },
        command: { type: "string", description: "SQL command to execute" },
        active: { type: "boolean", description: "Enable/disable job" }
      },
      required: ["action"]
    }
  },
  {
    name: "manage_vault",
    description: "List, get, create, update, or delete encrypted tenant secrets",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "set", "update", "delete"] },
        secret_name: { type: "string", description: "Secret name" },
        secret_value: { type: "string", description: "Secret value (for create/update)" },
        description: { type: "string", description: "Secret description" },
        scope: { type: "string", enum: ["global", "tenant", "user"], description: "Secret scope" }
      },
      required: ["action"]
    }
  },

  // ===== ISSUES & SEARCH =====
  {
    name: "list_issues",
    description: "List issues in the GitHub repository",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["open", "closed", "all"] },
        labels: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "search_code",
    description: "Search code in the repository",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" }
      },
      required: ["query"]
    }
  },

  // ===== ACTIVITY & LOGS =====
  {
    name: "log_activity",
    description: "Record an activity in the audit log",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action performed" },
        resource_type: { type: "string", description: "Type of resource" },
        resource_id: { type: "string", description: "Resource identifier" },
        metadata: { type: "object", description: "Additional data" }
      },
      required: ["action", "resource_type"]
    }
  },
  {
    name: "get_function_registry",
    description: "Get list of all registered functions with their status and dependencies",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category" },
        active_only: { type: "boolean", description: "Only show active functions" }
      }
    }
  }
];

// =====================================================
// API CALLER
// =====================================================

const functionEndpoints: Record<string, string> = {
  provision_tenant: "provision-tenant",
  invite_team_member: "invite-team-member",
  accept_invite: "accept-invite",
  manage_domain: "manage-domain",
  create_checkout: "create-checkout",
  customer_portal: "customer-portal",
  check_usage_limits: "check-usage-limits",
  track_usage: "track-usage",
  setup_page: "setup-page",
  deploy_page: "deploy-page",
  discover_services: "discover-services",
  configure_service: "configure-service",
  check_service_health: "check-service-health",
  update_service_catalog: "update-service-catalog",
  create_api_key: "create-api-key",
  validate_api_key: "validate-api-key",
  log_activity: "log-activity",
  manage_functions: "manage-functions",
  manage_secrets: "manage-secrets",
  manage_database: "manage-database",
  manage_cron: "manage-cron",
  manage_vault: "manage-vault",
};

// Admin-only functions
const adminFunctions = [
  "manage_functions",
  "manage_secrets", 
  "manage_database",
  "manage_cron",
  "update_service_catalog"
];

async function callEdgeFunction(name: string, args: Record<string, unknown>): Promise<unknown> {
  const endpoint = functionEndpoints[name];
  if (!endpoint) {
    throw new Error(`Unknown function: ${name}`);
  }

  const url = `${SUPABASE_URL}/functions/v1/${endpoint}`;
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
  };

  // Add auth based on function type
  if (adminFunctions.includes(name)) {
    headers["X-Admin-Key"] = ADMIN_KEY;
  } else if (USER_TOKEN) {
    headers["Authorization"] = `Bearer ${USER_TOKEN}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

// Special handler for function registry (reads from DB)
async function getFunctionRegistry(args: Record<string, unknown>): Promise<unknown> {
  // This queries the function_registry table directly
  const url = `${SUPABASE_URL}/rest/v1/function_registry`;
  
  let queryParams = "select=*";
  if (args.category) {
    queryParams += `&category=eq.${args.category}`;
  }
  if (args.active_only) {
    queryParams += `&is_active=eq.true`;
  }
  queryParams += "&order=category,function_name";

  const response = await fetch(`${url}?${queryParams}`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${ADMIN_KEY}`,
    },
  });

  return response.json();
}

// =====================================================
// MCP SERVER
// =====================================================

const server = new Server(
  {
    name: "supabase-saas-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    if (name === "get_function_registry") {
      result = await getFunctionRegistry(args as Record<string, unknown>);
    } else if (name === "list_issues" || name === "search_code") {
      // These would use GitHub API - placeholder for now
      result = { message: "Use GitHub MCP tools for this" };
    } else {
      result = await callEdgeFunction(name, args as Record<string, unknown>);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Supabase SaaS MCP Server running");
}

main().catch(console.error);
