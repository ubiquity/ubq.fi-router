/**
 * Static services and plugins list (independent of main router)
 */

import type { ServicesListResponse } from '../storage/types.ts'

/**
 * Get static services list (no external dependencies)
 */
export async function getServicesFromRouter(): Promise<ServicesListResponse> {
  // Static list of known UBQ.FI services
  const services = [
    '', // root domain (ubq.fi)
    'pay', // pay.ubq.fi
    'www', // www.ubq.fi (if it exists)
    'dao', // dao.ubq.fi (if it exists)
    'app', // app.ubq.fi (if it exists)
  ]

  // Static list of known plugins based on GitHub repositories
  const plugins = [
    {
      name: 'daemon-pricing',
      url: 'https://os-daemon-pricing.ubq.fi',
      routingDomain: 'os-daemon-pricing.ubq.fi',
      variants: ['main'],
      displayName: 'Daemon Pricing',
      description: 'Automated pricing daemon for issue bounties'
    },
    {
      name: 'permit-generation',
      url: 'https://os-permit-generation.ubq.fi',
      routingDomain: 'os-permit-generation.ubq.fi',
      variants: ['main'],
      displayName: 'Permit Generation',
      description: 'Generate permits for payout distributions'
    },
    {
      name: 'conversation-rewards',
      url: 'https://os-conversation-rewards.ubq.fi',
      routingDomain: 'os-conversation-rewards.ubq.fi',
      variants: ['main'],
      displayName: 'Conversation Rewards',
      description: 'Calculate rewards for GitHub conversations'
    },
    {
      name: 'issue-comment-embeddings',
      url: 'https://os-issue-comment-embeddings.ubq.fi',
      routingDomain: 'os-issue-comment-embeddings.ubq.fi',
      variants: ['main'],
      displayName: 'Issue Comment Embeddings',
      description: 'Generate embeddings for issue comments'
    },
    {
      name: 'user-activity-watcher',
      url: 'https://os-user-activity-watcher.ubq.fi',
      routingDomain: 'os-user-activity-watcher.ubq.fi',
      variants: ['main'],
      displayName: 'User Activity Watcher',
      description: 'Monitor user activity and contributions'
    },
    {
      name: 'assistive-pricing',
      url: 'https://os-assistive-pricing.ubq.fi',
      routingDomain: 'os-assistive-pricing.ubq.fi',
      variants: ['main'],
      displayName: 'Assistive Pricing',
      description: 'AI-assisted pricing recommendations'
    },
    {
      name: 'automated-merging',
      url: 'https://os-automated-merging.ubq.fi',
      routingDomain: 'os-automated-merging.ubq.fi',
      variants: ['main'],
      displayName: 'Automated Merging',
      description: 'Automated pull request merging'
    },
    {
      name: 'text-conversation-rewards',
      url: 'https://os-text-conversation-rewards.ubq.fi',
      routingDomain: 'os-text-conversation-rewards.ubq.fi',
      variants: ['main'],
      displayName: 'Text Conversation Rewards',
      description: 'Text-based conversation reward calculation'
    },
    {
      name: 'disqualify-handler',
      url: 'https://os-disqualify-handler.ubq.fi',
      routingDomain: 'os-disqualify-handler.ubq.fi',
      variants: ['main'],
      displayName: 'Disqualify Handler',
      description: 'Handle contributor disqualifications'
    },
    {
      name: 'comment-incentives',
      url: 'https://os-comment-incentives.ubq.fi',
      routingDomain: 'os-comment-incentives.ubq.fi',
      variants: ['main'],
      displayName: 'Comment Incentives',
      description: 'Incentive system for quality comments'
    }
  ]

  return {
    services,
    plugins,
    timestamp: new Date().toISOString()
  }
}
