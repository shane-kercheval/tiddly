import { useState } from 'react'
import { useAuthActions } from '../hooks/useAuthActions'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAuthStatus } from '../hooks/useAuthStatus'
import { CheckIcon } from '../components/icons'
import { FAQItem } from '../components/ui/FAQItem'
import tiersData from '../content/data/tiers.json'

// Tier values come from the canonical cross-stack tiers.json (single source with
// backend enforcement — KAN-154). Only display formatting lives here; the numbers
// do not. Qualitative cells (Included / Standard / Higher) aren't tier data.
type TierData = typeof tiersData.free
const free: TierData = tiersData.free
const standard: TierData = tiersData.standard
const pro: TierData = tiersData.pro

/** Item count, or "Unlimited" when the tier is flagged as such (display-only flag). */
const itemCount = (tier: TierData, value: number): string =>
  tier.unlimited_items ? 'Unlimited' : value.toLocaleString()
/**
 * Characters limit shown compactly on cards, e.g. 25000 → "25K". Uses the bookmark
 * content length as the single "per item" figure — safe because bookmark/note/prompt
 * limits are equal within each tier (enforced by a backend invariant test); revisit
 * this single-value display if those ever diverge.
 */
const charsCompact = (tier: TierData): string => `${tier.max_bookmark_content_length / 1000}K`
const retentionDays = (n: number): string => `${n} day${n === 1 ? '' : 's'}`
const aiCallsPerDay = (n: number): string => (n > 0 ? `${n.toLocaleString()} calls/day` : '—')

function FeatureItem({ children }: { children: ReactNode }): ReactNode {
  return (
    <li className="flex items-start gap-3">
      <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400" />
      <span>{children}</span>
    </li>
  )
}

/**
 * Signup button for unauthenticated visitors on the pricing page.
 */
function SignupButton({
  className,
  children,
}: {
  className: string
  children: ReactNode
}): ReactNode {
  const { login } = useAuthActions()
  return (
    <button
      onClick={() => login({ mode: 'signup' })}
      className={className}
    >
      {children}
    </button>
  )
}

function CTAButton({
  variant,
  size,
  tier,
}: {
  variant: 'primary' | 'secondary'
  size?: 'large'
  tier?: 'free' | 'standard' | 'pro'
}): ReactNode {
  const { isAuthenticated } = useAuthStatus()

  const baseClass = size === 'large'
    ? 'inline-block rounded-full px-10 py-4 text-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2'
    : 'mt-6 block w-full rounded-lg py-2.5 text-center text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2'

  const variantClass = variant === 'primary'
    ? 'bg-gray-900 text-white hover:bg-gray-800 hover:shadow-lg'
    : 'border border-gray-300 text-gray-700 hover:bg-gray-50'

  const className = `${baseClass} ${variantClass}`

  if (isAuthenticated || isDevMode) {
    // During beta, everyone is on Pro
    if (tier === 'pro') {
      return (
        <span className={`${baseClass} border border-gray-300 text-gray-500 cursor-default`}>
          Current Plan (Beta)
        </span>
      )
    }
    return (
      <Link to="/app/content" className={className}>
        Open App
      </Link>
    )
  }

  return (
    <SignupButton className={className}>
      Get Started
    </SignupButton>
  )
}

const comparisonData = [
  {
    category: 'Content',
    rows: [
      { feature: 'Bookmarks', free: itemCount(free, free.max_bookmarks), standard: itemCount(standard, standard.max_bookmarks), pro: itemCount(pro, pro.max_bookmarks) },
      { feature: 'Notes', free: itemCount(free, free.max_notes), standard: itemCount(standard, standard.max_notes), pro: itemCount(pro, pro.max_notes) },
      { feature: 'Prompt templates', free: itemCount(free, free.max_prompts), standard: itemCount(standard, standard.max_prompts), pro: itemCount(pro, pro.max_prompts) },
    ],
  },
  {
    category: 'Storage',
    rows: [
      { feature: 'Characters per content item', free: free.max_bookmark_content_length.toLocaleString(), standard: standard.max_bookmark_content_length.toLocaleString(), pro: pro.max_bookmark_content_length.toLocaleString() },
    ],
  },
  {
    category: 'API & Automation',
    rows: [
      { feature: 'Personal Access Tokens', free: String(free.max_pats), standard: String(standard.max_pats), pro: String(pro.max_pats) },
      { feature: 'Rate limits', free: 'Standard', standard: 'Higher', pro: 'Highest' },
      { feature: 'MCP integration', free: 'Included', standard: 'Included', pro: 'Included' },
      { feature: 'Chrome extension', free: 'Included', standard: 'Included', pro: 'Included' },
    ],
  },
  {
    category: 'AI Features',
    rows: [
      { feature: 'AI suggestions (tags, metadata, relationships)', free: aiCallsPerDay(free.rate_ai_per_day), standard: aiCallsPerDay(standard.rate_ai_per_day), pro: aiCallsPerDay(pro.rate_ai_per_day) },
      { feature: 'Bring your own API key', free: aiCallsPerDay(free.rate_ai_byok_per_day), standard: aiCallsPerDay(standard.rate_ai_byok_per_day), pro: aiCallsPerDay(pro.rate_ai_byok_per_day) },
    ],
  },
  {
    category: 'History & Versioning',
    rows: [
      { feature: 'Version history retention', free: retentionDays(free.history_retention_days), standard: retentionDays(standard.history_retention_days), pro: retentionDays(pro.history_retention_days) },
      { feature: 'Full-text search', free: 'Included', standard: 'Included', pro: 'Included' },
    ],
  },
]

/**
 * Public pricing page with Free, Standard, and Pro tier comparison.
 */
export function Pricing(): ReactNode {
  usePageTitle('Pricing')
  const [isAnnual, setIsAnnual] = useState(true)

  // Prices come from the canonical tiers.json (display-only `price` field), not hardcoded —
  // so they're single-sourced with the served /data/tiers.json an agent reads.
  const monthlyPrice = (tier: TierData): number =>
    isAnnual ? tier.price.annual_monthly_usd : tier.price.monthly_usd
  const standardPrice = monthlyPrice(standard)
  const proPrice = monthlyPrice(pro)
  const billingNote = isAnnual ? 'per month, billed annually' : 'per month'

  return (
    <div>
      {/* Hero */}
      <div className="pb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Simple, transparent pricing
        </h1>
      </div>

      {/* Beta Banner */}
      <div className="mx-auto mb-10 max-w-2xl rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center">
        <p className="text-sm text-yellow-800">
          <span className="font-medium">Currently in beta</span> — all accounts have Pro access at no charge. When beta ends, accounts will default to the Free tier unless upgraded. Your content will be preserved, but you won't be able to add new items if you're over the Free tier limits.
        </p>
      </div>

      {/* Monthly / Annual Toggle */}
      <div className="flex items-center justify-center gap-3 pb-10">
        <span className={`text-sm font-medium ${!isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>
          Monthly
        </span>
        <button
          onClick={() => setIsAnnual(!isAnnual)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAnnual ? 'bg-gray-900' : 'bg-gray-300'}`}
          role="switch"
          aria-checked={isAnnual}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${isAnnual ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
        <span className={`text-sm font-medium ${isAnnual ? 'text-gray-900' : 'text-gray-500'}`}>
          Annual
        </span>
        {isAnnual && (
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
            Save up to 50%
          </span>
        )}
      </div>

      {/* Pricing Cards */}
      <div className="grid gap-8 pb-20 lg:grid-cols-3">
        {/* Free Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8">
          <h2 className="text-lg font-semibold text-gray-900">Free</h2>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-5xl font-bold tracking-tight text-gray-900">${free.price.monthly_usd}</span>
          </div>
          <p className="mt-2 text-sm text-gray-500">Free forever</p>

          <CTAButton variant="secondary" tier="free" />

          <ul className="mt-8 space-y-4 text-sm text-gray-600">
            <FeatureItem>{free.max_bookmarks} bookmarks</FeatureItem>
            <FeatureItem>{free.max_notes} notes</FeatureItem>
            <FeatureItem>{free.max_prompts} prompt templates</FeatureItem>
            <FeatureItem>{charsCompact(free)} characters per item</FeatureItem>
            <FeatureItem>{free.max_pats} API tokens</FeatureItem>
            <FeatureItem>{retentionDays(free.history_retention_days)} version history</FeatureItem>
            <FeatureItem>Full-text search</FeatureItem>
            <FeatureItem>MCP integration</FeatureItem>
            <FeatureItem>Chrome extension</FeatureItem>
          </ul>
        </div>

        {/* Standard Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8">
          <h2 className="text-lg font-semibold text-gray-900">Standard</h2>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-5xl font-bold tracking-tight text-gray-900">${standardPrice}</span>
            <span className="text-lg text-gray-500">/mo</span>
          </div>
          <p className="mt-2 text-sm text-gray-500">{billingNote}</p>

          <CTAButton variant="secondary" tier="standard" />

          <ul className="mt-8 space-y-4 text-sm text-gray-600">
            <FeatureItem>{standard.max_bookmarks} bookmarks</FeatureItem>
            <FeatureItem>{standard.max_notes} notes</FeatureItem>
            <FeatureItem>{standard.max_prompts} prompt templates</FeatureItem>
            <FeatureItem>{charsCompact(standard)} characters per item</FeatureItem>
            <FeatureItem>{standard.max_pats} API tokens</FeatureItem>
            <FeatureItem>{retentionDays(standard.history_retention_days)} version history</FeatureItem>
            <FeatureItem>Higher rate limits</FeatureItem>
          </ul>
        </div>

        {/* Pro Card */}
        <div className="rounded-2xl border-2 border-gray-900 bg-gray-50 p-8">
          <h2 className="text-lg font-semibold text-gray-900">Pro</h2>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-5xl font-bold tracking-tight text-gray-900">${proPrice}</span>
            <span className="text-lg text-gray-500">/mo</span>
          </div>
          <p className="mt-2 text-sm text-gray-500">{billingNote}</p>

          <CTAButton variant="primary" tier="pro" />

          <ul className="mt-8 space-y-4 text-sm text-gray-600">
            <FeatureItem>
              {pro.unlimited_items
                ? <><strong>Unlimited</strong> bookmarks, notes & prompts</>
                : `${pro.max_bookmarks} bookmarks, notes & prompts`}
            </FeatureItem>
            <FeatureItem>{charsCompact(pro)} characters per item</FeatureItem>
            <FeatureItem>AI-powered suggestions</FeatureItem>
            <FeatureItem>{pro.max_pats} API tokens</FeatureItem>
            <FeatureItem>{retentionDays(pro.history_retention_days)} version history</FeatureItem>
            <FeatureItem>Highest rate limits</FeatureItem>
          </ul>
        </div>
      </div>

      {/* Full Feature Comparison Table */}
      <div className="pb-20">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">
          Full feature comparison
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-4 pr-4 text-left text-sm font-medium text-gray-500" />
                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-900">Free</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-900">Standard</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-gray-900">Pro</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.map((section) => (
                <ComparisonSection key={section.category} section={section} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="pb-20">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">
          Frequently Asked Questions
        </h2>
        <div>
          <FAQItem question="Can I try Pro before committing?">
            <p>
              During beta, everyone has Pro access at no charge. After beta, the Free tier gives
              you access to all core features (except AI suggestions) — upgrade when you need more capacity.
            </p>
          </FAQItem>

          <FAQItem question="What happens if I hit a limit?">
            <p>
              You'll see a clear error message explaining which limit you've reached, with an
              option to upgrade. Your existing content is never affected — you just can't create
              new items until you upgrade or free up space.
            </p>
          </FAQItem>

          <FAQItem question="Can I downgrade from Pro to Free?">
            <p>
              Yes. Your data is kept, but Free tier limits re-apply. If you're over the Free
              limits, you won't be able to create new items until you're within the limits,
              but nothing is deleted.
            </p>
          </FAQItem>

          <FAQItem question="Do you offer refunds?">
            <p>
              Paid plans haven't launched yet. A refund policy will be announced when they do.
            </p>
          </FAQItem>

          <FAQItem question="What about AI features?">
            <p>
              AI-powered suggestions (tags, titles, descriptions, relationships, and prompt arguments)
              are available on the Pro plan. You can also bring your own API key for higher limits
              and custom model selection. See the comparison table above for details.
              MCP integration and prompt templates are included in all tiers.
            </p>
          </FAQItem>

          <FAQItem question="Is there a self-hosted option?">
            <p>
              Yes! Tiddly's code is{' '}
              <a
                href="https://github.com/shane-kercheval/tiddly"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                publicly available
              </a>
              {' '}and can be self-hosted for complete control over your data with no tier limits.
            </p>
          </FAQItem>
        </div>
      </div>

      {/* Final CTA */}
      <div className="mb-4 rounded-2xl bg-gray-50 px-8 py-16 text-center">
        <h2 className="mb-4 text-3xl font-bold text-gray-900">Start for free</h2>
        <p className="mb-8 text-lg text-gray-500">
          All features included. Upgrade when you need more capacity.
        </p>
        <CTAButton variant="primary" size="large" />
      </div>
    </div>
  )
}

function ComparisonSection({
  section,
}: {
  section: { category: string; rows: { feature: string; free: string; standard: string; pro: string }[] }
}): ReactNode {
  return (
    <>
      <tr>
        <td
          colSpan={4}
          className="pb-2 pt-6 text-xs font-semibold uppercase tracking-wider text-gray-400"
        >
          {section.category}
        </td>
      </tr>
      {section.rows.map((row) => (
        <tr key={row.feature} className="border-b border-gray-100">
          <td className="py-3 pr-4 text-sm text-gray-600">{row.feature}</td>
          <td className="px-4 py-3 text-center text-sm text-gray-600">{row.free}</td>
          <td className="px-4 py-3 text-center text-sm text-gray-600">{row.standard}</td>
          <td className="px-4 py-3 text-center text-sm font-medium text-gray-900">{row.pro}</td>
        </tr>
      ))}
    </>
  )
}
