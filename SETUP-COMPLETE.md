# Setup Complete ✓

Your multi-tenant SaaS infrastructure is fully configured and ready to use.

---

## Your Configuration

| Item | Value |
|:--|:--|
| **Supabase Project** | `azgdvzilnusiaqxiyfce` |
| **Tenant ID** | `f62bc2d1-5dda-4b0f-afa1-300c104b5f50` |
| **Tenant Name** | My Company |
| **Tenant Slug** | my-company |
| **Plan** | pro |

---

## Edge Function Endpoints

All functions are live at:

| Function | Endpoint | Purpose |
|:--|:--|:--|
| **provision-tenant** | `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/provision-tenant` | Create new tenant + Stripe customer |
| **setup-page** | `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/setup-page` | Get injectable HTML snippets |
| **deploy-page** | `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/deploy-page` | Deploy to Cloudflare Pages |
| **stripe-webhook** | `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/stripe-webhook` | Handle Stripe events |
| **gads-message-match** | `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/gads-message-match` | Google Ads keyword matching |
| **create-checkout** | `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/create-checkout` | Create Stripe checkout session |
| **customer-portal** | `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/customer-portal` | Stripe billing portal |

---

## Database Schema

### New Tables Created

```
public.tenants
├── id (UUID, PK)
├── name (TEXT)
├── slug (TEXT, UNIQUE)
├── stripe_customer_id (TEXT, UNIQUE)
├── plan (TEXT: free/starter/pro/enterprise)
├── settings (JSONB)
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)

public.user_tenants
├── id (UUID, PK)
├── user_id (UUID, FK → auth.users)
├── tenant_id (UUID, FK → tenants)
├── role (TEXT: owner/admin/member/viewer)
├── is_default (BOOLEAN)
└── created_at (TIMESTAMPTZ)

public.page_deployments
├── id (UUID, PK)
├── tenant_id (UUID, FK → tenants)
├── page_id (TEXT)
├── environment (TEXT: preview/production)
├── cloudflare_deployment_id (TEXT)
├── html_hash (TEXT)
├── deployed_at (TIMESTAMPTZ)
└── deployed_by (UUID, FK → auth.users)

public.gads_impressions
├── id (UUID, PK)
├── tenant_id (UUID, FK → tenants)
├── page_id (TEXT)
├── gclid (TEXT)
├── keyword (TEXT)
├── url (TEXT)
├── matched_config (BOOLEAN)
└── created_at (TIMESTAMPTZ)
```

### Modified Tables (tenant_id added)

- `public.agents` + tenant_id
- `public.workflows` + tenant_id
- `public.crawlers` + tenant_id
- `public.documents` + tenant_id
- `public.mcp_servers` + tenant_id
- `public.settings` + tenant_id
- `public.pages` + tenant_id, cloudflare_project, cloudflare_url, deployed_at, gads_config
- `public.page_embeddings` + tenant_id

### RLS Policies

All tables have Row Level Security enabled with tenant isolation:
- Users can only see/modify data where `tenant_id` matches their current tenant
- Tenant determined by JWT claim or `user_tenants.is_default`

---

## Environment Variables Configured

| Secret | Purpose |
|:--|:--|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin access for Edge Functions |
| `STRIPE_TEST_PUBLISHABLE_KEY` | Test mode public key (pk_test_...) |
| `STRIPE_TEST_SECRET_KEY` | Test mode secret key (sk_test_...) |
| `STRIPE_LIVE_PUBLISHABLE_KEY` | Live mode public key (pk_live_...) |
| `STRIPE_LIVE_SECRET_KEY` | Live mode secret key (sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (whsec_...) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with Pages edit permission |

---

## Usage Examples

### 1. Link a User to Your Tenant

When a user signs up, link them to your tenant:

```sql
-- Run in Supabase SQL Editor
INSERT INTO public.user_tenants (user_id, tenant_id, role, is_default)
VALUES (
  'USER_UUID_FROM_AUTH_USERS',
  'f62bc2d1-5dda-4b0f-afa1-300c104b5f50',
  'owner',
  true
);
```

### 2. Provision a New Tenant (for new customers)

```javascript
const response = await fetch('https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/provision-tenant', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + userAccessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tenant_name: 'Acme Corp',
    slug: 'acme-corp'
  })
});

const { tenant, stripe_customer_id } = await response.json();
// tenant.id = new tenant UUID
// stripe_customer_id = Stripe customer ID (cus_...)
```

### 3. Get Page Setup Snippets (Test Mode)

```javascript
const response = await fetch('https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/setup-page', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + userAccessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    page_id: 'your-page-id',
    environment: 'test',  // or 'production'
    features: {
      auth: true,
      stripe: true,
      gads_matching: true
    },
    gads_config: {
      keywords: {
        'cheap': { headline: 'Affordable Pricing', cta: 'Save 50%' },
        'enterprise': { headline: 'Enterprise Solution', cta: 'Contact Sales' },
        'free trial': { headline: 'Start Free', cta: 'Try 14 Days Free' }
      },
      default: { headline: 'Welcome', cta: 'Get Started' }
    }
  })
});

const { snippets, instructions } = await response.json();

// snippets.head - Add to <head>
// snippets.auth_init - Supabase auth setup
// snippets.auth_form - Login/signup form HTML
// snippets.stripe_init - Stripe.js setup
// snippets.stripe_button - Checkout button
// snippets.gads_init - Google Ads message matching
// snippets.gads_example - Example HTML with data-gads attributes
```

### 4. Deploy Page to Cloudflare

```javascript
const response = await fetch('https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/deploy-page', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + userAccessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    page_id: 'your-page-id',
    project_name: 'my-landing-page'  // optional, auto-generated if omitted
  })
});

const { success, url, preview_url, deployment_id } = await response.json();
// url = https://my-landing-page.pages.dev
// preview_url = unique deployment URL
```

### 5. Create Stripe Checkout Session

```javascript
const response = await fetch('https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/create-checkout', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + userAccessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tenant_id: 'f62bc2d1-5dda-4b0f-afa1-300c104b5f50',
    price_id: 'price_xxxxxxxxxxxxx',  // From Stripe Dashboard
    mode: 'subscription',  // or 'payment' for one-time
    success_url: 'https://yourapp.com/success',
    cancel_url: 'https://yourapp.com/pricing'
  })
});

const { url } = await response.json();
window.location.href = url;  // Redirect to Stripe Checkout
```

### 6. Open Customer Portal

```javascript
const response = await fetch('https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/customer-portal', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + userAccessToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tenant_id: 'f62bc2d1-5dda-4b0f-afa1-300c104b5f50',
    return_url: 'https://yourapp.com/settings'
  })
});

const { url } = await response.json();
window.location.href = url;  // Redirect to Stripe Portal
```

---

## Stripe Setup Required

### 1. Create Products with Plan Tiers

In [Stripe Dashboard → Products](https://dashboard.stripe.com/products):

| Product Name | Price | Metadata |
|:--|:--|:--|
| Starter Plan | $29/month | `plan_tier` = `starter` |
| Pro Plan | $79/month | `plan_tier` = `pro` |
| Enterprise Plan | $199/month | `plan_tier` = `enterprise` |

The `plan_tier` metadata is used by `stripe-webhook` to update `tenants.plan` automatically.

### 2. Webhook Events

Your webhook at `https://azgdvzilnusiaqxiyfce.supabase.co/functions/v1/stripe-webhook` handles:

- `customer.subscription.created` → Sets tenant plan
- `customer.subscription.updated` → Updates tenant plan
- `customer.subscription.deleted` → Downgrades to free
- `invoice.payment_failed` → Flags payment issue

### 3. Customer Portal Configuration

In [Stripe Dashboard → Settings → Billing → Customer Portal](https://dashboard.stripe.com/settings/billing/portal):

- Enable subscription management
- Enable invoice history
- Set allowed subscription changes

---

## Google Ads Message Matching

### How It Works

1. User clicks Google Ad with keyword (e.g., `?keyword=cheap&gclid=xxx`)
2. Page loads and calls `gads-message-match` endpoint
3. Function returns text replacements based on keyword
4. JavaScript updates elements with `data-gads` attributes

### HTML Setup

```html
<h1 data-gads="headline">Default Headline</h1>
<p data-gads="subheadline">Default description</p>
<button data-gads="cta">Get Started</button>
```

### Configuration (in setup-page call)

```javascript
gads_config: {
  keywords: {
    'cheap': {
      headline: 'Affordable Pricing for Everyone',
      subheadline: 'Save up to 50% compared to competitors',
      cta: 'Start Saving Today'
    },
    'enterprise': {
      headline: 'Enterprise-Grade Security',
      subheadline: 'SOC2 compliant with dedicated support',
      cta: 'Talk to Sales'
    }
  },
  default: {
    headline: 'Welcome to Our Platform',
    subheadline: 'The best solution for your needs',
    cta: 'Get Started Free'
  }
}
```

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR APP                                  │
│  (Page Generator / Admin Dashboard)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ setup-page    │   │ deploy-page   │   │ provision-    │
│               │   │               │   │ tenant        │
│ Returns HTML  │   │ Pushes to     │   │               │
│ snippets for  │   │ Cloudflare    │   │ Creates       │
│ auth/stripe/  │   │ Pages         │   │ tenant +      │
│ gads          │   │               │   │ Stripe cust   │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        │                     ▼                     │
        │           ┌───────────────┐               │
        │           │ Cloudflare    │               │
        │           │ Pages         │               │
        │           │ (Production)  │               │
        │           └───────────────┘               │
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SUPABASE                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Auth        │  │ Database    │  │ Edge        │              │
│  │ (users)     │  │ (tenants,   │  │ Functions   │              │
│  │             │  │  pages,     │  │             │              │
│  │             │  │  etc.)      │  │             │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        STRIPE                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Customers   │  │ Subscrip-   │  │ Webhooks    │              │
│  │ (linked to  │  │ tions       │  │ (→ stripe-  │              │
│  │  tenants)   │  │             │  │  webhook)   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## User Signup Flow

```
1. User signs up via Supabase Auth
   └─→ auth.users row created

2. Your app calls provision-tenant (or links to existing tenant)
   └─→ tenants row created (with Stripe customer)
   └─→ user_tenants row created (role: owner)

3. User creates content (agents, pages, etc.)
   └─→ All rows automatically get tenant_id via RLS

4. User upgrades via create-checkout
   └─→ Stripe Checkout session
   └─→ Webhook fires on success
   └─→ tenants.plan updated automatically
```

---

## Troubleshooting

### "No tenant found" error
User is not linked to any tenant. Run:
```sql
INSERT INTO public.user_tenants (user_id, tenant_id, role, is_default)
VALUES ('user-uuid', 'f62bc2d1-5dda-4b0f-afa1-300c104b5f50', 'member', true);
```

### "Unauthorized" error
Check that:
- Authorization header includes valid Supabase access token
- Token format: `Bearer eyJhbG...`

### Stripe webhook not updating plan
Verify:
- Product has `plan_tier` in metadata
- Webhook secret matches `STRIPE_WEBHOOK_SECRET`
- Check Stripe webhook logs for errors

### Cloudflare deployment fails
Verify:
- `CLOUDFLARE_ACCOUNT_ID` is correct
- `CLOUDFLARE_API_TOKEN` has "Edit Cloudflare Pages" permission
- Project name contains only lowercase letters, numbers, and hyphens

---

## Quick Reference

```javascript
// Your Supabase client setup
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://azgdvzilnusiaqxiyfce.supabase.co',
  'YOUR_ANON_KEY'
)

// Get current user's access token
const { data: { session } } = await supabase.auth.getSession()
const accessToken = session?.access_token

// Call Edge Functions
const { data, error } = await supabase.functions.invoke('setup-page', {
  body: { page_id: 'xxx', environment: 'test', features: { auth: true } }
})
```

---

## Files in This Repository

```
├── README.md                    # Architecture overview
├── SETUP-COMPLETE.md           # This file
├── sql/
│   ├── 01-migration.sql        # Tenant tables + tenant_id columns
│   ├── 02-rls-policies.sql     # Row Level Security policies
│   ├── 03-page-deployments.sql # Deployment tracking
│   └── 04-gads-analytics.sql   # Google Ads impressions
└── functions/
    ├── provision-tenant/       # Create tenant + Stripe customer
    ├── setup-page/             # Get HTML snippets
    ├── deploy-page/            # Deploy to Cloudflare
    ├── stripe-webhook/         # Handle Stripe events
    ├── gads-message-match/     # Keyword matching
    ├── create-checkout/        # Stripe checkout
    └── customer-portal/        # Stripe billing portal
```

---

*Setup completed: January 20, 2026*
