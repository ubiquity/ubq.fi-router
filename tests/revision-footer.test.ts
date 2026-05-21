import { describe, expect, test } from 'bun:test'
import {
  decorateHtmlWithRevision,
  repositoryUrlForHost,
} from '../src/utils/revision-footer'

describe('revision footer decoration', () => {
  test('updates an existing git revision link', () => {
    const html = '<body><div id="bottom-right"><a href="#" id="git-revision" target="_blank">unknown</a></div></body>'

    const decorated = decorateHtmlWithRevision(html, {
      revision: '91bebfb78f2b7c1e319cf6d3ee229c6426665a6b',
      repositoryUrl: 'https://github.com/ubiquity/work.ubq.fi',
    })

    expect(decorated).toContain('https://github.com/ubiquity/work.ubq.fi/commit/91bebfb78f2b7c1e319cf6d3ee229c6426665a6b')
    expect(decorated).toContain('>91bebfb<')
    expect(decorated).not.toContain('unknown')
    expect(decorated).not.toContain('uos-router-revision-footer')
  })

  test('appends a styled footer when the app has no git revision link', () => {
    const decorated = decorateHtmlWithRevision('<html><body><main>ok</main></body></html>', {
      revision: 'abcdef1234567890',
      repositoryUrl: 'https://github.com/ubiquity/pay.ubq.fi',
    })

    expect(decorated).toContain('id="uos-router-revision-footer"')
    expect(decorated).toContain('https://github.com/ubiquity/pay.ubq.fi/commit/abcdef1234567890')
    expect(decorated).toContain('>abcdef1<')
    expect(decorated.indexOf('uos-router-revision-footer')).toBeLessThan(decorated.indexOf('</body>'))
  })

  test('derives app repository URLs from ubq.fi hostnames', () => {
    expect(repositoryUrlForHost('work.ubq.fi')).toBe('https://github.com/ubiquity/work.ubq.fi')
    expect(repositoryUrlForHost('preview-pay.ubq.fi')).toBe('https://github.com/ubiquity/pay.ubq.fi')
    expect(repositoryUrlForHost('ubq.fi')).toBe('https://github.com/ubiquity/ubq.fi')
  })
})
