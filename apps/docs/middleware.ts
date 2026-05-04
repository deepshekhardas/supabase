import { isbot } from 'isbot'
import { NextResponse, type NextRequest } from 'next/server'

import { clientSdkIds } from '~/content/navigation.references'
import { BASE_PATH } from '~/lib/constants'

const REFERENCE_PATH = `${BASE_PATH ?? ''}/reference`
const GUIDES_PATH = `${BASE_PATH ?? ''}/guides`

// LLM user agents that should get markdown content
const LLM_USER_AGENTS = [
  'claude',
  'anthropic',
  'openai',
  'chatgpt',
  'gpt-4',
  'cursor',
  'copilot',
  'llm',
  'ai-bot',
]

// Parse Accept header with q-values and return sorted by priority
function parseAcceptHeader(accept: string | null): Array<{ type: string; q: number }> {
  if (!accept) return []

  return accept
    .split(',')
    .map((part) => {
      const [type, ...params] = part.trim().split(';')
      const qParam = params.find((p) => p.trim().startsWith('q='))
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0
      return { type: type.trim(), q: isNaN(q) ? 1.0 : q }
    })
    .sort((a, b) => b.q - a.q)
}

// Check if user agent is an LLM/bot that wants markdown
function isLLMUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return false
  const lowerUA = userAgent.toLowerCase()
  return LLM_USER_AGENTS.some((agent) => lowerUA.includes(agent))
}

export function middleware(request: NextRequest) {
  const url = new URL(request.url)
  const userAgent = request.headers.get('user-agent')
  const accept = request.headers.get('accept')

  // Serve pre-generated .md files before the [[...slug]] page route can intercept them
  if (url.pathname.startsWith(GUIDES_PATH + '/') && url.pathname.endsWith('.md')) {
    const slug = url.pathname.slice(GUIDES_PATH.length + 1, -'.md'.length)
    const rewriteUrl = new URL(url)
    rewriteUrl.pathname = `${BASE_PATH ?? ''}/api/guides-md/${slug}`
    return NextResponse.rewrite(rewriteUrl)
  }

  // Content negotiation for /guides/* (not /reference/*)
  if (url.pathname.startsWith(GUIDES_PATH + '/')) {
    const acceptTypes = parseAcceptHeader(accept)

    // Check if this is an LLM/bot that wants markdown
    const wantsMarkdown =
      isLLMUserAgent(userAgent) ||
      acceptTypes.some(
        ({ type }) =>
          type === 'text/markdown' ||
          type === 'text/x-markdown' ||
          type === 'application/markdown'
      )

    // Check for explicit text/html preference
    const wantsHTML = acceptTypes.some(({ type }) => type === 'text/html')

    // Check if browser-style Accept header (has text/html as highest priority)
    const isBrowserRequest =
      !acceptTypes.length ||
      (acceptTypes[0]?.type === 'text/html' && acceptTypes[0]?.q >= 0.9)

    // LLM/bot requesting markdown - serve the .md file
    if (wantsMarkdown && !isBrowserRequest) {
      const slug = url.pathname.slice(GUIDES_PATH.length + 1)
      const rewriteUrl = new URL(url)
      rewriteUrl.pathname = `${BASE_PATH ?? ''}/api/guides-md/${slug}`
      return NextResponse.rewrite(rewriteUrl)
    }

    // Check for unsupported Accept types that should get 406
    if (acceptTypes.length > 0) {
      const topType = acceptTypes[0]?.type
      const unsupportedTypes = ['application/json', 'application/xml', 'text/plain']
      const explicitlyUnsupported = unsupportedTypes.some(
        (t) => topType === t || topType?.startsWith(t + ';')
      )
      const isWildcard = topType === '*/*'

      // Return 406 for explicitly unsupported types (not wildcard)
      if (explicitlyUnsupported && !isWildcard && !wantsHTML) {
        const response = new NextResponse('Not Acceptable', {
          status: 406,
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
            Vary: 'Accept',
          },
        })
        return response
      }
    }
  }

  if (!url.pathname.startsWith(REFERENCE_PATH)) {
    return NextResponse.next()
  }

  if (isbot(userAgent)) {
    let [, lib, maybeVersion, ...slug] = url.pathname.replace(REFERENCE_PATH, '').split('/')

    if (clientSdkIds.includes(lib)) {
      const version = /v\d+/.test(maybeVersion) ? maybeVersion : undefined
      if (!version) {
        slug = [maybeVersion, ...slug]
      }

      if (slug.length > 0) {
        const rewriteUrl = new URL(url)
        rewriteUrl.pathname = (BASE_PATH ?? '') + '/api/crawlers'
        return NextResponse.rewrite(rewriteUrl)
      }
    }
  }

  const [, lib, maybeVersion] = url.pathname.replace(REFERENCE_PATH, '').split('/')

  if (lib === 'cli') {
    const rewritePath = [REFERENCE_PATH, 'cli'].join('/')
    return NextResponse.rewrite(new URL(rewritePath, request.url))
  }

  if (lib === 'api') {
    const rewritePath = [REFERENCE_PATH, 'api'].join('/')
    return NextResponse.rewrite(new URL(rewritePath, request.url))
  }

  if (lib?.startsWith('self-hosting-')) {
    const rewritePath = [REFERENCE_PATH, lib].join('/')
    return NextResponse.rewrite(new URL(rewritePath, request.url))
  }

  if (clientSdkIds.includes(lib)) {
    const version = /v\d+/.test(maybeVersion) ? maybeVersion : null
    const rewritePath = [REFERENCE_PATH, lib, version].filter(Boolean).join('/')
    return NextResponse.rewrite(new URL(rewritePath, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/reference/:path*', '/guides/:path*'],
}
