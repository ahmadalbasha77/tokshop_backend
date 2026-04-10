/**
 * Generates HTML email template for show analytics
 */
function generateShowAnalyticsEmail(data) {
  const {
    showTitle,
    showTime,
    itemsSold,
    giveaways,
    shipments,
    totalSales,
    tipsReceived,
    viewers,
    newFollowers,
    showAnalyticsUrl,
  } = data;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Show Analytics - ${showTitle}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">
                📊 Your Show Analytics
              </h1>
            </td>
          </tr>
          
          <!-- Show Info -->
          <tr>
            <td style="padding: 30px; background-color: #f8f9fa;">
              <h2 style="margin: 0 0 8px 0; color: #1a1a1a; font-size: 20px; font-weight: 600;">
                ${showTitle}
              </h2>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                ${showTime}
              </p>
            </td>
          </tr>
          
          <!-- Analytics Section -->
          <tr>
            <td style="padding: 30px;">
              <h3 style="margin: 0 0 20px 0; color: #1a1a1a; font-size: 18px; font-weight: 600;">
                Show Analytics
              </h3>
              
              <!-- Metrics Grid -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <!-- Items Sold -->
                <tr>
                  <td style="padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">Items Sold</td>
                        <td align="right" style="color: #1a1a1a; font-size: 20px; font-weight: 600;">${itemsSold}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Giveaways -->
                <tr>
                  <td style="padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">Giveaways</td>
                        <td align="right" style="color: #1a1a1a; font-size: 20px; font-weight: 600;">${giveaways}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Shipments -->
                <tr>
                  <td style="padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">Shipments</td>
                        <td align="right" style="color: #1a1a1a; font-size: 20px; font-weight: 600;">${shipments}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Total Sales -->
                <tr>
                  <td style="padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">Total Sales</td>
                        <td align="right" style="color: #10b981; font-size: 24px; font-weight: 700;">$${totalSales.toFixed(2)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Tips Received -->
                <tr>
                  <td style="padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">Tips Received</td>
                        <td align="right" style="color: #8b5cf6; font-size: 24px; font-weight: 700;">$${tipsReceived.toFixed(2)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Viewers -->
                <tr>
                  <td style="padding: 16px 0; border-bottom: 1px solid #e5e7eb;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">Viewers</td>
                        <td align="right" style="color: #1a1a1a; font-size: 20px; font-weight: 600;">${viewers}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- New Followers -->
                <tr>
                  <td style="padding: 16px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color: #6b7280; font-size: 14px;">New Followers</td>
                        <td align="right" style="color: #1a1a1a; font-size: 20px; font-weight: 600;">${newFollowers}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- CTA Button -->
          <tr>
            <td style="padding: 30px; text-align: center; background-color: #f8f9fa;">
              <a href="${showAnalyticsUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                Start Shipping
              </a>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">
                Thank you for hosting on TokshopLive!
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} TokshopLive. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generates plain text email template for show analytics
 */
function generateShowAnalyticsTextEmail(data) {
  const {
    showTitle,
    showTime,
    itemsSold,
    giveaways,
    shipments,
    totalSales,
    tipsReceived,
    viewers,
    newFollowers,
    showAnalyticsUrl,
  } = data;

  return `
📊 Your Show Analytics

${showTitle}
${showTime}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Show Analytics:

Items Sold:       ${itemsSold}
Giveaways:        ${giveaways}
Shipments:        ${shipments}
Total Sales:      $${totalSales.toFixed(2)}
Tips Received:    $${tipsReceived.toFixed(2)}
Viewers:          ${viewers}
New Followers:    ${newFollowers}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Start Shipping:
${showAnalyticsUrl}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Thank you for hosting on TokshopLive!

© ${new Date().getFullYear()} TokshopLive. All rights reserved.
  `.trim();
}

module.exports = {
  generateShowAnalyticsEmail,
  generateShowAnalyticsTextEmail,
};