import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

/**
 * Footer component with policy and legal links.
 *
 * Displays:
 * - Privacy Policy link
 * - Terms of Service link
 * - License information (GitHub link)
 * - Copyright notice
 */
export function Footer(): ReactNode {
  return (
    <footer className="bg-white border-t border-gray-200 mt-auto py-2 md:py-0 md:h-12 shrink-0 flex items-center">
      <div className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 w-full">
        <div className="flex flex-col md:flex-row items-center justify-between gap-1 md:gap-0">
          <div className="flex items-center space-x-6 text-sm text-gray-600">
            <Link
              to="/docs"
              className="hover:text-gray-900 transition-colors"
            >
              Docs
            </Link>
            <Link
              to="/privacy"
              className="hover:text-gray-900 transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              to="/terms"
              className="hover:text-gray-900 transition-colors"
            >
              Terms of Service
            </Link>
            <a
              href="https://github.com/shane-kercheval/tiddly/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-900 transition-colors"
            >
              License
            </a>
            <a
              href="https://github.com/shane-kercheval/tiddly"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-900 transition-colors"
            >
              GitHub
            </a>
          </div>
          <div className="text-sm text-gray-500">
            © 2025 Tiddly. Operated by Shane Kercheval.
          </div>
        </div>
      </div>
    </footer>
  )
}
