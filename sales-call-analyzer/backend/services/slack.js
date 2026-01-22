/**
 * Slack Integration Service
 * Connects to Slack channels to track deal closures and churn
 *
 * Channels:
 * - #signups_affiliate-finder: Track software deal signups
 * - #payments_affiliate-finder: Track active customers and churn
 */

const fetch = require('node-fetch');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_API_BASE = 'https://slack.com/api';

// Channel IDs (will be populated on init)
let channelIds = {
  signups: null,
  payments: null
};

/**
 * Make a Slack API request
 */
async function slackRequest(endpoint, params = {}) {
  if (!SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  const url = new URL(`${SLACK_API_BASE}/${endpoint}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data;
}

/**
 * Initialize Slack integration - find channel IDs
 */
async function initSlack() {
  if (!SLACK_BOT_TOKEN) {
    console.log('Slack integration disabled - no bot token configured');
    return false;
  }

  try {
    // Get list of channels
    const result = await slackRequest('conversations.list', {
      types: 'public_channel,private_channel',
      limit: 200
    });

    for (const channel of result.channels || []) {
      if (channel.name === 'signups_affiliate-finder') {
        channelIds.signups = channel.id;
        console.log(`Found signups channel: ${channel.id}`);
      }
      if (channel.name === 'payments_affiliate-finder') {
        channelIds.payments = channel.id;
        console.log(`Found payments channel: ${channel.id}`);
      }
    }

    if (!channelIds.signups) {
      console.warn('Could not find #signups_affiliate-finder channel');
    }
    if (!channelIds.payments) {
      console.warn('Could not find #payments_affiliate-finder channel');
    }

    return true;
  } catch (error) {
    console.error('Error initializing Slack:', error.message);
    return false;
  }
}

/**
 * Search for a prospect in the signups channel
 * Returns deal info if found
 */
async function findDealInSignups(prospectName, website, brand) {
  if (!channelIds.signups) {
    return null;
  }

  try {
    // Get channel history (last 1000 messages)
    const result = await slackRequest('conversations.history', {
      channel: channelIds.signups,
      limit: 1000
    });

    const searchTerms = [
      prospectName?.toLowerCase(),
      website?.toLowerCase(),
      brand?.toLowerCase()
    ].filter(Boolean);

    if (searchTerms.length === 0) {
      return null;
    }

    for (const message of result.messages || []) {
      const text = message.text?.toLowerCase() || '';

      // Check if any search term matches
      const matches = searchTerms.some(term => text.includes(term));

      if (matches) {
        // Parse the message to extract deal info
        const dealInfo = parseSignupMessage(message);
        return {
          found: true,
          dealClosed: true,
          dealType: dealInfo.type || 'software',
          signupDate: new Date(parseFloat(message.ts) * 1000).toISOString(),
          messageText: message.text,
          ...dealInfo
        };
      }
    }

    return { found: false, dealClosed: false };
  } catch (error) {
    console.error('Error searching signups:', error.message);
    return null;
  }
}

/**
 * Parse a signup message to extract deal info
 */
function parseSignupMessage(message) {
  const text = message.text || '';
  const info = {
    type: 'software', // Default to software
    plan: null,
    amount: null
  };

  // Look for DFY/agency indicators
  const dfyKeywords = ['dfy', 'done for you', 'agency', 'managed', 'full service', '$1800', '$1,800'];
  if (dfyKeywords.some(kw => text.toLowerCase().includes(kw))) {
    info.type = 'dfy';
  }

  // Try to extract plan name
  const planMatch = text.match(/plan[:\s]+([^\n,]+)/i);
  if (planMatch) {
    info.plan = planMatch[1].trim();
  }

  // Try to extract amount
  const amountMatch = text.match(/\$[\d,]+(?:\.\d{2})?/);
  if (amountMatch) {
    info.amount = amountMatch[0];
  }

  return info;
}

/**
 * Check if a customer is still active or churned
 * Searches the payments channel for payment history
 */
async function checkCustomerStatus(prospectName, website, brand) {
  if (!channelIds.payments) {
    return null;
  }

  try {
    // Get channel history
    const result = await slackRequest('conversations.history', {
      channel: channelIds.payments,
      limit: 1000
    });

    const searchTerms = [
      prospectName?.toLowerCase(),
      website?.toLowerCase(),
      brand?.toLowerCase()
    ].filter(Boolean);

    if (searchTerms.length === 0) {
      return null;
    }

    // Look for messages about this customer
    const customerMessages = [];

    for (const message of result.messages || []) {
      const text = message.text?.toLowerCase() || '';

      if (searchTerms.some(term => text.includes(term))) {
        customerMessages.push({
          date: new Date(parseFloat(message.ts) * 1000),
          text: message.text,
          isChurn: isChurnMessage(text),
          isPayment: isPaymentMessage(text),
          isRefund: isRefundMessage(text)
        });
      }
    }

    if (customerMessages.length === 0) {
      return { found: false };
    }

    // Sort by date (most recent first)
    customerMessages.sort((a, b) => b.date - a.date);

    // Determine current status
    const mostRecent = customerMessages[0];
    const lastPayment = customerMessages.find(m => m.isPayment);
    const lastChurn = customerMessages.find(m => m.isChurn);

    let status = 'unknown';
    if (lastChurn && (!lastPayment || lastChurn.date > lastPayment.date)) {
      status = 'churned';
    } else if (lastPayment) {
      // Check if payment is recent (within last 45 days)
      const daysSincePayment = (Date.now() - lastPayment.date.getTime()) / (1000 * 60 * 60 * 24);
      status = daysSincePayment < 45 ? 'active' : 'at_risk';
    }

    return {
      found: true,
      status,
      lastPaymentDate: lastPayment?.date?.toISOString() || null,
      churnDate: lastChurn?.date?.toISOString() || null,
      totalMessages: customerMessages.length,
      isActive: status === 'active',
      isChurned: status === 'churned'
    };
  } catch (error) {
    console.error('Error checking customer status:', error.message);
    return null;
  }
}

/**
 * Check if a message indicates churn
 */
function isChurnMessage(text) {
  const churnKeywords = [
    'canceled', 'cancelled', 'churn', 'churned',
    'subscription ended', 'stopped', 'refund',
    'unsubscribed', 'left', 'departed'
  ];
  return churnKeywords.some(kw => text.includes(kw));
}

/**
 * Check if a message indicates a payment
 */
function isPaymentMessage(text) {
  const paymentKeywords = [
    'payment', 'paid', 'invoice', 'charged',
    'renewal', 'renewed', 'subscription',
    'successfully', 'processed'
  ];
  return paymentKeywords.some(kw => text.includes(kw)) && !isChurnMessage(text);
}

/**
 * Check if a message indicates a refund
 */
function isRefundMessage(text) {
  const refundKeywords = ['refund', 'refunded', 'credit', 'reversed'];
  return refundKeywords.some(kw => text.includes(kw));
}

/**
 * Get full deal status for a prospect
 * Combines signup and payment data
 */
async function getProspectDealStatus(prospectName, website, brand) {
  const [signupInfo, paymentStatus] = await Promise.all([
    findDealInSignups(prospectName, website, brand),
    checkCustomerStatus(prospectName, website, brand)
  ]);

  return {
    signup: signupInfo,
    payment: paymentStatus,
    summary: {
      dealClosed: signupInfo?.dealClosed || false,
      dealType: signupInfo?.type || null,
      isActive: paymentStatus?.isActive || false,
      isChurned: paymentStatus?.isChurned || false,
      status: paymentStatus?.status || (signupInfo?.dealClosed ? 'signed_up' : 'not_found')
    }
  };
}

/**
 * Check if Slack is configured and working
 */
function isSlackConfigured() {
  return !!SLACK_BOT_TOKEN && (!!channelIds.signups || !!channelIds.payments);
}

module.exports = {
  initSlack,
  findDealInSignups,
  checkCustomerStatus,
  getProspectDealStatus,
  isSlackConfigured
};
