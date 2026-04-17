import { useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAuthStatus } from '../hooks/useAuthStatus'
import { CheckIcon } from '../components/icons'
import { FAQItem } from '../components/ui/FAQItem'

function FeatureItem({ children }: { children: ReactNode }): ReactNode {
  return (
    <li className="flex items-start gap-3">
      <CheckIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400" />
      <span>{children}</span>
    </li>
  )
}

/**
 * Auth0 signup button — only rendered in production mode (when Auth0Provider exists).
 */
function Auth0SignupButton({
  className,
  children,
}: {
  className: string
  children: ReactNode
}): ReactNode {
  const { loginWithRedirect } = useAuth0()
  return (
    <button
      onClick={() => loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } })}
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
    <Auth0SignupButton className={className}>
      Get Started
    </Auth0SignupButton>
  )
}

const comparisonData = [
  {
    category: 'Content',
    rows: [
      { feature: 'Bookmarks', free: '10', standard: '250', pro: 'Unlimited' },
      { feature: 'Notes', free: '10', standard: '100', pro: 'Unlimited' },
      { feature: 'Prompt templates', free: '5', standard: '50', pro: 'Unlimited' },
    ],
  },
  {
    category: 'Storage',
    rows: [
      { feature: 'Characters per content item', free: '25,000', standard: '50,000', pro: '100,000' },
    ],
  },
  {
    category: 'API & Automation',
    rows: [
      { feature: 'Personal Access Tokens', free: '3', standard: '10', pro: '50' },
      { feature: 'Rate limits', free: 'Standard', standard: 'Higher', pro: 'Highest' },
      { feature: 'MCP integration', free: 'Included', standard: 'Included', pro: 'Included' },
      { feature: 'Chrome extension', free: 'Included', standard: 'Included', pro: 'Included' },
    ],
  },
  {
    category: 'AI Features',
    rows: [
      { feature: 'AI suggestions (tags, metadata, relationships)', free: '—', standard: '—', pro: '500 calls/day' },
      { feature: 'Bring your own API key', free: '—', standard: '—', pro: '2,000 calls/day' },
    ],
  },
  {
    category: 'History & Versioning',
    rows: [
      { feature: 'Version history retention', free: '1 day', standard: '5 days', pro: '15 days' },
      { feature: 'Full-text search', free: 'Included', standard: 'Included', pro: 'Included' },
    ],
  },
]

/**
 * Public pricing page with Free, Standard, and Pro tier comparison.
 */
export function Pricing(): ReactNode {
  usePageTitle('Pricing')
  const [isAnnual, setIsAnnual] = useState(false)

  const standardPrice = isAnnual ? '1' : '2'
  const standardBillingNote = isAnnual ? 'per month, billed annually' : 'per month'
  const proPrice = isAnnual ? '4' : '5'
  const proBillingNote = isAnnual ? 'per month, billed annually' : 'per month'

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
            <span className="text-5xl font-bold tracking-tight text-gray-900">$0</span>
          </div>
          <p className="mt-2 text-sm text-gray-500">Free forever</p>

          <CTAButton variant="secondary" tier="free" />

          <ul className="mt-8 space-y-4 text-sm text-gray-600">
            <FeatureItem>10 bookmarks</FeatureItem>
            <FeatureItem>10 notes</FeatureItem>
            <FeatureItem>5 prompt templates</FeatureItem>
            <FeatureItem>25K characters per item</FeatureItem>
            <FeatureItem>3 API tokens</FeatureItem>
            <FeatureItem>1-day version history</FeatureItem>
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
          <p className="mt-2 text-sm text-gray-500">{standardBillingNote}</p>

          <CTAButton variant="secondary" tier="standard" />

          <ul className="mt-8 space-y-4 text-sm text-gray-600">
            <FeatureItem>250 bookmarks</FeatureItem>
            <FeatureItem>100 notes</FeatureItem>
            <FeatureItem>50 prompt templates</FeatureItem>
            <FeatureItem>50K characters per item</FeatureItem>
            <FeatureItem>10 API tokens</FeatureItem>
            <FeatureItem>5-day version history</FeatureItem>
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
          <p className="mt-2 text-sm text-gray-500">{proBillingNote}</p>

          <CTAButton variant="primary" tier="pro" />

          <ul className="mt-8 space-y-4 text-sm text-gray-600">
            <FeatureItem><strong>Unlimited</strong> bookmarks, notes & prompts</FeatureItem>
            <FeatureItem>100K characters per item</FeatureItem>
            <FeatureItem>AI-powered suggestions</FeatureItem>
            <FeatureItem>50 API tokens</FeatureItem>
            <FeatureItem>15-day version history</FeatureItem>
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
