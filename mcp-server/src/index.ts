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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_KEY = process.env.ADMIN_KEY!;
const USER_TOKEN = process.env.SUPABASE_USER_TOKEN; // Optional: for user-scoped operations
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";

// =====================================================
// TOOL DEFINITIONS
// =====================================================

const tools: Tool[] = [
  // ===== AUTHENTICATION =====
  {
    name: "auth_sign_up",
    description: "Create a new user account",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "User email address" },
        password: { type: "string", description: "User password (min 6 chars)" },
        metadata: { type: "object", description: "Optional user metadata (name, etc.)" }
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
        access_token: { type: "string", description: "Current access token to invalidate" }
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
        email: { type: "string", description: "Email address to send reset link" }
      },
      required: ["email"]
    }
  },
  {
    name: "auth_update_password",
    description: "Update user password (requires valid session)",
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
    description: "Create user account AND provision tenant in one call (complete onboarding)",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "User email address" },
        password: { type: "string", description: "User password (min 6 chars)" },
        tenant_name: { type: "string", description: "Organization/company name" },
        tenant_slug: { type: "string", description: "URL-friendly slug (optional, auto-generated from name)" },
        user_metadata: { type: "object", description: "Optional user metadata" }
      },
      required: ["email", "password", "tenant_name"]
    }
  },

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
// AUTH HANDLERS (Direct Supabase Auth API calls)
// =====================================================

async function handleAuthSignUp(args: Record<string, unknown>): Promise<unknown> {
  const { email, password, metadata } = args as { 
    email: string; 
    password: string; 
    metadata?: Record<string, unknown>;
  };

  // Create user via Admin API
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
  });

  const userData = await createResponse.json();
  
  if (!createResponse.ok) {
    throw new Error(userData.message || userData.error || "Failed to create user");
  }

  // Auto sign-in to return session
  const signInResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const session = await signInResponse.json();

  return {
    user: userData,
    session: signInResponse.ok ? session : null,
    access_token: session?.access_token,
    refresh_token: session?.refresh_token,
    message: "User created successfully",
  };
}

async function handleAuthSignIn(args: Record<string, unknown>): Promise<unknown> {
  const { email, password } = args as { email: string; password: string };

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Sign in failed");
  }

  return {
    user: data.user,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: data.expires_at,
  };
}

async function handleAuthSignOut(args: Record<string, unknown>): Promise<unknown> {
  const { access_token } = args as { access_token: string };

  const response = await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${access_token}`,
    },
  });

  if (!response.ok && response.status !== 204) {
    const data = await response.json();
    throw new Error(data.error || "Sign out failed");
  }

  return { message: "Signed out successfully" };
}

async function handleAuthGetUser(args: Record<string, unknown>): Promise<unknown> {
  const { access_token } = args as { access_token: string };

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${access_token}`,
    },
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || "Failed to get user");
  }

  return { user: data };
}

async function handleAuthRefreshToken(args: Record<string, unknown>): Promise<unknown> {
  const { refresh_token } = args as { refresh_token: string };

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Token refresh failed");
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: data.expires_at,
  };
}

async function handleAuthResetPassword(args: Record<string, unknown>): Promise<unknown> {
  const { email } = args as { email: string };

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
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Password reset failed");
  }

  return { message: "Password reset email sent" };
}

async function handleAuthUpdatePassword(args: Record<string, unknown>): Promise<unknown> {
  const { access_token, new_password } = args as { 
    access_token: string; 
    new_password: string;
  };

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${access_token}`,
    },
    body: JSON.stringify({ password: new_password }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || "Password update failed");
  }

  return { message: "Password updated successfully", user: data };
}

async function handleAuthSignUpWithTenant(args: Record<string, unknown>): Promise<unknown> {
  const { email, password, tenant_name, tenant_slug, user_metadata } = args as {
    email: string;
    password: string;
    tenant_name: string;
    tenant_slug?: string;
    user_metadata?: Record<string, unknown>;
  };

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
  });

  const userData = await createResponse.json();
  
  if (!createResponse.ok) {
    throw new Error(userData.message || userData.error || "Failed to create user");
  }

  // 2. Sign in to get session
  const signInResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const session = await signInResponse.json();
  
  if (!signInResponse.ok) {
    throw new Error(session.error || "Failed to sign in after account creation");
  }

  // 3. Create tenant via REST API (using service role for admin access)
  const slug = tenant_slug || tenant_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  
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
  });

  const tenantData = await tenantResponse.json();
  
  if (!tenantResponse.ok) {
    throw new Error(tenantData.message || "Failed to create tenant");
  }

  const tenant = Array.isArray(tenantData) ? tenantData[0] : tenantData;

  // 4. Link user to tenant as owner
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
  });

  if (!linkResponse.ok) {
    const linkError = await linkResponse.json();
    throw new Error(linkError.message || "Failed to link user to tenant");
  }

  return {
    user: userData,
    tenant: tenant,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    message: "Account and tenant created successfully",
  };
}

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

// Auth functions handled locally (not via Edge Functions)
const authFunctions = [
  "auth_sign_up",
  "auth_sign_in",
  "auth_sign_out",
  "auth_get_user",
  "auth_refresh_token",
  "auth_reset_password",
  "auth_update_password",
  "auth_sign_up_with_tenant",
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
    version: "1.1.0",
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

    // Route auth functions to local handlers
    if (name === "auth_sign_up") {
      result = await handleAuthSignUp(args as Record<string, unknown>);
    } else if (name === "auth_sign_in") {
      result = await handleAuthSignIn(args as Record<string, unknown>);
    } else if (name === "auth_sign_out") {
      result = await handleAuthSignOut(args as Record<string, unknown>);
    } else if (name === "auth_get_user") {
      result = await handleAuthGetUser(args as Record<string, unknown>);
    } else if (name === "auth_refresh_token") {
      result = await handleAuthRefreshToken(args as Record<string, unknown>);
    } else if (name === "auth_reset_password") {
      result = await handleAuthResetPassword(args as Record<string, unknown>);
    } else if (name === "auth_update_password") {
      result = await handleAuthUpdatePassword(args as Record<string, unknown>);
    } else if (name === "auth_sign_up_with_tenant") {
      result = await handleAuthSignUpWithTenant(args as Record<string, unknown>);
    } else if (name === "get_function_registry") {
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
  console.error("Supabase SaaS MCP Server running (v1.1.0 with Auth)");
}

main().catch(console.error);
