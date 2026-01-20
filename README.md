# Supabase Multi-Tenant SaaS Infrastructure

A complete multi-tenant SaaS backend built on Supabase with Stripe billing, Cloudflare deployment, multi-domain email, and Google Ads integration.

## Features

- **Multi-tenancy** - Full tenant isolation with RLS
- **Team Management** - Invite members with automatic emails
- **Multi-Domain Email** - Each tenant/page sends from its own domain via Resend
- **Usage Tracking** - Plan limits with automatic enforcement
- **API Keys** - Programmatic access for developers
- **Service Discovery** - Dynamic feature catalog
- **Stripe Integration** - Subscriptions, checkout, customer portal
- **Cloudflare Pages** - One-click deployment
- **Google Ads** - Dynamic message matching

## Quick Start

1. Run SQL migrations in order (`sql/01-*.sql` through `sql/09-*.sql`)
2. Deploy all 20 Edge Functions
3. Configure secrets in Supabase dashboard
4. See [SETUP-COMPLETE.md](SETUP-COMPLETE.md) for detailed instructions
5. See [GETTING-STARTED.md](GETTING-STARTED.md) for user scenarios

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR FRONTEND APP                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SUPABASE EDGE FUNCTIONS                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ Auth/Tenant │ │  Billing    │ │  Deploy     │            │
│  │ Management  │ │  & Usage    │ │  & Pages    │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│  ┌─────────────┐ ┌─────────────┐                            │
│  │   Domain    │ │    Email    │                            │
│  │ Management  │ │   Resend    │                            │
│  └─────────────┘ └─────────────┘                            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Supabase    │    │    Stripe     │    │  Cloudflare   │
│   Database    │    │   Payments    │    │    Pages      │
└───────────────┘    └───────────────┘    └───────────────┘
        │                                         │
        ▼                                         ▼
┌───────────────┐                        ┌───────────────┐
│    Resend     │                        │   Porkbun     │
│    Email      │                        │     DNS       │
└───────────────┘                        └───────────────┘
```

## Database Schema

### Core Tables
- `tenants` - Organizations/workspaces
- `user_tenants` - User membership with roles
- `invites` - Pending team invitations
- `domains` - Custom domains per tenant
- `email_templates` - Customizable email templates
- `email_log` - Email delivery tracking

### App Tables (with tenant_id)
- `pages` - Generated landing pages (linked to domains)
- `agents` - AI agents configuration
- `workflows` - Automation workflows
- `crawlers` - Web crawlers
- `documents` - Uploaded documents
- `mcp_servers` - MCP server configs
- `settings` - Tenant settings

### Platform Tables
- `services` - Available service catalog
- `service_status` - Health monitoring
- `tenant_services` - Per-tenant service config
- `plan_limits` - Feature limits by plan
- `usage_records` - Aggregated usage
- `api_keys` - Developer API keys
- `activity_log` - Audit trail

## Edge Functions (20 total)

### Tenant & Team
| Function | Purpose |
|:--|:--|
| `provision-tenant` | Create tenant + Stripe customer |
| `invite-team-member` | Send invite with email via Resend |
| `accept-invite` | Join a tenant |

### Domain & Email
| Function | Purpose |
|:--|:--|
| `manage-domain` | Add, verify, delete domains |

### Billing & Usage
| Function | Purpose |
|:--|:--|
| `create-checkout` | Stripe checkout session |
| `customer-portal` | Stripe billing portal |
| `stripe-webhook` | Handle Stripe events |
| `check-usage-limits` | Verify plan limits |
| `track-usage` | Record usage events |

### Deployment
| Function | Purpose |
|:--|:--|
| `setup-page` | Get injectable snippets |
| `deploy-page` | Push to Cloudflare Pages |
| `gads-message-match` | Dynamic ad content |

### Service Discovery
| Function | Purpose |
|:--|:--|
| `discover-services` | List available services |
| `configure-service` | Enable/configure service |
| `check-service-health` | Monitor service status |
| `update-service-catalog` | Admin: manage services |

### Developer Tools
| Function | Purpose |
|:--|:--|
| `create-api-key` | Generate API key |
| `validate-api-key` | Verify API key |
| `log-activity` | Record audit events |

## Multi-Domain Email System

Each tenant can have multiple domains. Emails are sent from the appropriate domain:

```
Tenant: Acme Corp
├── Domain: acme.com (primary)
│   └── Emails sent as: hello@acme.com
├── Domain: acme-sales.com
│   └── Emails sent as: support@acme-sales.com
└── Pages:
    ├── Landing Page A → uses acme.com
    └── Landing Page B → uses acme-sales.com
```

### Domain Management API

```typescript
// Add a domain
POST /manage-domain
{ "action": "add", "domain": "mysite.com" }
// Returns DNS records to configure

// Verify domain (after DNS configured)
POST /manage-domain
{ "action": "verify", "domain_id": "uuid" }

// Set primary domain
POST /manage-domain
{ "action": "set_primary", "domain_id": "uuid" }

// Configure email sender
POST /manage-domain
{
  "action": "update_email",
  "domain_id": "uuid",
  "email_from_name": "Acme Support",
  "email_from_address": "support"  // becomes support@domain.com
}

// List all domains
POST /manage-domain
{ "action": "list" }

// Delete domain
POST /manage-domain
{ "action": "delete", "domain_id": "uuid" }
```

### Team Invites with Email

```typescript
// Invite automatically sends email from correct domain
POST /invite-team-member
{
  "email": "teammate@example.com",
  "role": "member",
  "message": "Welcome to the team!",  // Optional
  "page_id": "xxx",  // Optional: send from this page's domain
  "domain_id": "xxx"  // Optional: send from specific domain
}

// Response
{
  "success": true,
  "invite_url": "https://app.com/invite/token123",
  "email_sent": true,
  "expires_at": "2026-01-27T12:00:00Z"
}
```

## Plan Limits

| Feature | Free | Starter | Pro | Enterprise |
|:--|:--|:--|:--|:--|
| Pages | 3 | 10 | 50 | Unlimited |
| Deployments/mo | 10 | 100 | 500 | Unlimited |
| Team Members | 1 | 3 | 10 | Unlimited |
| API Calls/mo | 100 | 1,000 | 10,000 | Unlimited |
| Storage (MB) | 100 | 1,000 | 10,000 | Unlimited |
| Custom Domains | 0 | 1 | 5 | Unlimited |

## Environment Variables

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Stripe
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...

# Email (Resend)
RESEND_FULL=re_...

# DNS (Porkbun) - Optional
PORKBUN_API_KEY=...
PORKBUN_SECRET_KEY=...

# App
ADMIN_KEY=your-admin-secret
APP_URL=https://your-app.com
```

## SQL Migrations

Run in order:

| File | Purpose |
|:--|:--|
| `01-migration.sql` | Core tables, tenant_id columns |
| `02-rls-policies.sql` | Row Level Security |
| `03-page-deployments.sql` | Deployment tracking |
| `04-gads-analytics.sql` | Google Ads impressions |
| `05-service-discovery.sql` | Service catalog |
| `06-team-management.sql` | Invites, activity log |
| `07-usage-and-limits.sql` | Plan limits, usage tracking |
| `08-api-keys.sql` | API key management |
| `09-domains.sql` | Multi-domain, email templates |

## Documentation

- **[GETTING-STARTED.md](GETTING-STARTED.md)** - User scenarios & frontend integration
- **[API-REFERENCE.md](API-REFERENCE.md)** - Complete API documentation
- **[SETUP-COMPLETE.md](SETUP-COMPLETE.md)** - Your setup details & secrets

## Shared Utilities

Reusable code in `functions/_shared/`:

| File | Purpose |
|:--|:--|
| `security.ts` | Auth, rate limiting, CORS, validation |
| `middleware.ts` | Request wrapper with built-in security |
| `email.ts` | Multi-domain email via Resend |

## License

MIT
