import { NextRequest, NextResponse } from 'next/server'
import { middleware } from './middleware'

// Mock isbot
jest.mock('isbot', () => ({
  isbot: jest.fn(() => false),
}))

// Mock the constants
jest.mock('~/lib/constants', () => ({
  BASE_PATH: '',
}))

jest.mock('~/content/navigation.references', () => ({
  clientSdkIds: ['js', 'py', 'dart'],
}))

// Mock the guides-md API endpoint exists
jest.mock('./app/api/guides-md/route', () => ({}), { virtual: true })

describe('middleware', () => {
  const createRequest = (pathname: string, headers: Record<string, string> = {}) => {
    const url = `https://supabase.com${pathname}`
    return new NextRequest(url, { headers })
  }

  describe('Accept header content negotiation', () => {
    it('should serve markdown for text/markdown Accept header', () => {
      const req = createRequest('/docs/guides/auth', {
        Accept: 'text/markdown',
      })
      const res = middleware(req)

      expect(res).toBeInstanceOf(NextResponse)
      expect((res as any).headers.get('x-middleware-rewrite')).toContain('/api/guides-md/')
    })

    it('should serve HTML for browser-style Accept header with q-values', () => {
      const req = createRequest('/docs/guides/auth', {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      })
      const res = middleware(req)

      // Should continue to next (not rewrite)
      expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    })

    it('should serve HTML when text/html has higher q-value than text/markdown', () => {
      const req = createRequest('/docs/guides/auth', {
        Accept: 'text/html;q=1.0, text/markdown;q=0.5',
      })
      const res = middleware(req)

      expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    })

    it('should serve markdown when text/markdown has higher q-value', () => {
      const req = createRequest('/docs/guides/auth', {
        Accept: 'text/markdown;q=1.0, text/html;q=0.5',
      })
      const res = middleware(req)

      expect((res as any).headers.get('x-middleware-rewrite')).toContain('/api/guides-md/')
    })

    it('should return 406 for unsupported Accept types', () => {
      const req = createRequest('/docs/guides/auth', {
        Accept: 'application/json',
      })
      const res = middleware(req)

      expect(res.status).toBe(406)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Vary')).toBe('Accept')
    })

    it('should not return 406 for wildcard Accept', () => {
      const req = createRequest('/docs/guides/auth', {
        Accept: '*/*',
      })
      const res = middleware(req)

      expect(res.status).not.toBe(406)
    })

    it('should allow text/html to bypass 406', () => {
      const req = createRequest('/docs/guides/auth', {
        Accept: 'application/json, text/html;q=0.9',
      })
      const res = middleware(req)

      expect(res.status).not.toBe(406)
    })
  })

  describe('LLM User-Agent detection', () => {
    const llmAgents = [
      'Claude-User/1.0',
      'Mozilla/5.0 (compatible; Anthropic Claude/1.0)',
      'OpenAI-GPT-4',
      'ChatGPT-User/1.0',
      'Cursor/1.0',
      'GitHub Copilot',
    ]

    llmAgents.forEach((agent) => {
      it(`should serve markdown for ${agent} user agent`, () => {
        const req = createRequest('/docs/guides/auth', {
          'User-Agent': agent,
        })
        const res = middleware(req)

        expect((res as any).headers.get('x-middleware-rewrite')).toContain('/api/guides-md/')
      })
    })

    it('should serve HTML for regular browser without LLM UA', () => {
      const req = createRequest('/docs/guides/auth', {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
      })
      const res = middleware(req)

      expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    })
  })

  describe('.md file requests', () => {
    it('should rewrite .md files to api/guides-md', () => {
      const req = createRequest('/docs/guides/auth.md')
      const res = middleware(req)

      expect((res as any).headers.get('x-middleware-rewrite')).toContain('/api/guides-md/auth')
    })
  })

  describe('/reference/* paths', () => {
    it('should not apply Accept header logic to /reference paths', () => {
      const req = createRequest('/docs/reference/js', {
        Accept: 'application/json',
      })
      const res = middleware(req)

      expect(res.status).not.toBe(406)
    })
  })

  describe('training crawlers', () => {
    it('should identify training-crawler as LLM agent', () => {
      const req = createRequest('/docs/guides/auth', {
        'User-Agent': 'Training-Crawler/1.0 (LLM Training Data Collection)',
      })
      const res = middleware(req)

      expect((res as any).headers.get('x-middleware-rewrite')).toContain('/api/guides-md/')
    })

    it('should identify substring-embed as LLM agent', () => {
      const req = createRequest('/docs/guides/auth', {
        'User-Agent': 'Substring-Embed/1.0 (AI Embeddings Bot)',
      })
      const res = middleware(req)

      expect((res as any).headers.get('x-middleware-rewrite')).toContain('/api/guides-md/')
    })
  })
})
