/**
 * Email Service
 * Handles sending emails via Mailchimp Transactional (Mandrill)
 *
 * Configuration:
 * - MANDRILL_API_KEY: Mandrill API key (from Mailchimp Transactional)
 * - EMAIL_FROM_ADDRESS: Sender email address
 * - EMAIL_FROM_NAME: Sender display name
 * - APP_URL: Base URL for the application (for magic links)
 *
 * In development/test mode, emails are logged to console instead of sent.
 */

const https = require('https');

// Configuration from environment
const MANDRILL_API_KEY = process.env.MANDRILL_API_KEY || '';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'noreply@affiliatefinder.ai';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Sales Call Analyzer';
const APP_URL = process.env.APP_URL || 'http://localhost:3001';

// Check if email sending is enabled
const isEmailEnabled = () => {
  return MANDRILL_API_KEY && process.env.NODE_ENV === 'production';
};

/**
 * Send an email via Mandrill API
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.toName - Recipient name (optional)
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content
 * @returns {Promise<Object>} - Result
 */
async function sendEmail(options) {
  const { to, toName, subject, html, text } = options;

  // In dev/test mode, log to console
  if (!isEmailEnabled()) {
    console.log('[EmailService] DEV MODE - Email would be sent:');
    console.log(`  To: ${toName ? `${toName} <${to}>` : to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Content: ${text || html}`);
    return {
      success: true,
      devMode: true,
      message: 'Email logged to console (dev mode)'
    };
  }

  const payload = {
    key: MANDRILL_API_KEY,
    message: {
      from_email: EMAIL_FROM_ADDRESS,
      from_name: EMAIL_FROM_NAME,
      to: [
        {
          email: to,
          name: toName || to,
          type: 'to'
        }
      ],
      subject: subject,
      html: html,
      text: text,
      tags: ['sales-call-analyzer', 'authentication']
    }
  };

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    const options = {
      hostname: 'mandrillapp.com',
      port: 443,
      path: '/api/1.0/messages/send.json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          if (Array.isArray(result) && result[0]) {
            const status = result[0].status;
            if (status === 'sent' || status === 'queued') {
              resolve({
                success: true,
                messageId: result[0]._id,
                status: status
              });
            } else {
              resolve({
                success: false,
                error: result[0].reject_reason || 'Email rejected',
                status: status
              });
            }
          } else if (result.status === 'error') {
            resolve({
              success: false,
              error: result.message || 'Mandrill API error',
              code: result.code
            });
          } else {
            resolve({
              success: false,
              error: 'Unexpected response from Mandrill',
              response: result
            });
          }
        } catch (parseError) {
          resolve({
            success: false,
            error: 'Failed to parse Mandrill response',
            response: data
          });
        }
      });
    });

    req.on('error', (error) => {
      console.error('[EmailService] Request error:', error);
      resolve({
        success: false,
        error: error.message
      });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send a magic link email
 * @param {string} to - Recipient email
 * @param {string} name - Recipient name (optional)
 * @param {string} token - Magic link token
 * @param {Object} options - Additional options
 * @param {number} options.expiresInMinutes - Token expiry time
 * @returns {Promise<Object>} - Result
 */
async function sendMagicLinkEmail(to, name, token, options = {}) {
  const expiresInMinutes = options.expiresInMinutes || 60;
  const magicLinkUrl = `${APP_URL}/admin/login.html?token=${token}`;

  const subject = 'Your login link for Sales Call Analyzer';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 520px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .header h1 { color: #073b55; font-size: 24px; margin: 0; }
    .content { background: #f9fafb; border-radius: 8px; padding: 32px; margin-bottom: 24px; }
    .button { display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 500; font-size: 16px; }
    .button:hover { background: #1d4ed8; }
    .footer { color: #6b7280; font-size: 13px; text-align: center; }
    .url { word-break: break-all; color: #6b7280; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Sales Call Analyzer</h1>
    </div>
    <div class="content">
      <p>Hello${name ? ` ${name}` : ''},</p>
      <p>Click the button below to sign in to Sales Call Analyzer:</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${magicLinkUrl}" class="button">Sign In</a>
      </p>
      <p style="color: #6b7280; font-size: 14px;">This link will expire in ${expiresInMinutes} minutes.</p>
      <p class="url">If the button doesn't work, copy and paste this URL into your browser:<br>${magicLinkUrl}</p>
    </div>
    <div class="footer">
      <p>This email was sent by Sales Call Analyzer at AffiliateFinder.ai</p>
      <p>If you didn't request this login link, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Hello${name ? ` ${name}` : ''},

Click the link below to sign in to Sales Call Analyzer:

${magicLinkUrl}

This link will expire in ${expiresInMinutes} minutes.

If you didn't request this login link, you can safely ignore this email.

---
Sales Call Analyzer - AffiliateFinder.ai
  `.trim();

  const result = await sendEmail({
    to,
    toName: name,
    subject,
    html,
    text
  });

  if (!result.success) {
    console.error('[EmailService] Failed to send magic link email:', result);
  }

  return result;
}

/**
 * Send access request notification to admins
 * @param {string[]} adminEmails - List of admin emails
 * @param {Object} request - Access request details
 * @returns {Promise<Object>} - Result
 */
async function sendAccessRequestNotification(adminEmails, request) {
  if (!adminEmails || adminEmails.length === 0) {
    return { success: false, error: 'No admin emails provided' };
  }

  const subject = `New access request: ${request.email}`;
  const reviewUrl = `${APP_URL}/admin/access-requests.html`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 520px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .header h1 { color: #073b55; font-size: 24px; margin: 0; }
    .content { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 24px; margin-bottom: 24px; }
    .info-row { margin-bottom: 8px; }
    .info-label { color: #6b7280; font-size: 13px; }
    .info-value { font-size: 14px; color: #1f2937; }
    .button { display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; }
    .footer { color: #6b7280; font-size: 13px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Sales Call Analyzer</h1>
    </div>
    <div class="content">
      <p style="margin: 0 0 16px; font-weight: 500;">New access request submitted</p>
      <div class="info-row">
        <span class="info-label">Email:</span>
        <span class="info-value">${request.email}</span>
      </div>
      ${request.name ? `
      <div class="info-row">
        <span class="info-label">Name:</span>
        <span class="info-value">${request.name}</span>
      </div>
      ` : ''}
      <div class="info-row">
        <span class="info-label">Requested:</span>
        <span class="info-value">${new Date(request.createdAt).toLocaleString()}</span>
      </div>
    </div>
    <p style="text-align: center;">
      <a href="${reviewUrl}" class="button">Review Request</a>
    </p>
    <div class="footer">
      <p>This notification was sent by Sales Call Analyzer.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
New access request submitted

Email: ${request.email}
${request.name ? `Name: ${request.name}` : ''}
Requested: ${new Date(request.createdAt).toLocaleString()}

Review request: ${reviewUrl}

---
Sales Call Analyzer - AffiliateFinder.ai
  `.trim();

  // Send to all admin emails
  const results = await Promise.all(
    adminEmails.map(email =>
      sendEmail({
        to: email,
        subject,
        html,
        text
      })
    )
  );

  const allSuccess = results.every(r => r.success);
  return {
    success: allSuccess,
    results
  };
}

/**
 * Send approval notification to user
 * @param {string} to - User email
 * @param {string} name - User name
 * @returns {Promise<Object>} - Result
 */
async function sendApprovalNotification(to, name) {
  const loginUrl = `${APP_URL}/admin/login.html`;
  const subject = 'Your access request has been approved';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 520px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .header h1 { color: #073b55; font-size: 24px; margin: 0; }
    .content { background: #dcfce7; border: 1px solid #bbf7d0; border-radius: 8px; padding: 24px; margin-bottom: 24px; }
    .button { display: inline-block; background: #16a34a; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; }
    .footer { color: #6b7280; font-size: 13px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Sales Call Analyzer</h1>
    </div>
    <div class="content">
      <p style="margin: 0 0 8px; font-weight: 500; color: #166534;">Your access request has been approved!</p>
      <p style="margin: 0; color: #166534;">Hello${name ? ` ${name}` : ''}, you can now sign in to Sales Call Analyzer.</p>
    </div>
    <p style="text-align: center;">
      <a href="${loginUrl}" class="button">Sign In</a>
    </p>
    <div class="footer">
      <p>This email was sent by Sales Call Analyzer at AffiliateFinder.ai</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Your access request has been approved!

Hello${name ? ` ${name}` : ''}, you can now sign in to Sales Call Analyzer.

Sign in: ${loginUrl}

---
Sales Call Analyzer - AffiliateFinder.ai
  `.trim();

  return sendEmail({
    to,
    toName: name,
    subject,
    html,
    text
  });
}

/**
 * Send denial notification to user
 * @param {string} to - User email
 * @param {string} reason - Denial reason (optional)
 * @returns {Promise<Object>} - Result
 */
async function sendDenialNotification(to, reason = null) {
  const subject = 'Your access request has been reviewed';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 520px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .header h1 { color: #073b55; font-size: 24px; margin: 0; }
    .content { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin-bottom: 24px; }
    .footer { color: #6b7280; font-size: 13px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Sales Call Analyzer</h1>
    </div>
    <div class="content">
      <p>Your access request to Sales Call Analyzer has been reviewed and could not be approved at this time.</p>
      ${reason ? `<p style="color: #6b7280; font-style: italic;">${reason}</p>` : ''}
      <p>If you believe this was a mistake, please contact an administrator.</p>
    </div>
    <div class="footer">
      <p>This email was sent by Sales Call Analyzer at AffiliateFinder.ai</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Your access request to Sales Call Analyzer has been reviewed and could not be approved at this time.

${reason ? `Reason: ${reason}\n\n` : ''}If you believe this was a mistake, please contact an administrator.

---
Sales Call Analyzer - AffiliateFinder.ai
  `.trim();

  return sendEmail({
    to,
    subject,
    html,
    text
  });
}

module.exports = {
  sendEmail,
  sendMagicLinkEmail,
  sendAccessRequestNotification,
  sendApprovalNotification,
  sendDenialNotification,
  isEmailEnabled
};
