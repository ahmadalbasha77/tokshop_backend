const functions = require("./functions");
const EmailTemplate = require("../models/templates");
function replacePlaceholders(template, data) {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

function convertToHex(color) {
  if (!color) return '#000000';
  if (color.length === 8 && color.startsWith('FF')) {
    return '#' + color.substring(2);
  }
  return color.startsWith('#') ? color : '#' + color;
}
async function sendEmail(placeholders, toemail, slug, subject) {
  let settings = await functions.getSettings();
  // console.log(settings);
  const provider = settings == null || settings == "" ? 'mailgun' : settings.default_email_provider;

  if (!settings.email_from_address) {
    throw new Error("From email address not configured");
  }

  const fromEmail = settings.email_from_address;

  const emailTemplate = await EmailTemplate.findOne({ slug });
  if (!emailTemplate) {
    throw new Error("Email template not found");
  }
  placeholders.app_name = settings.app_name || settings.seo_title || 'IconaLive';
  placeholders.support_email = settings.support_email || 'support@tokshoplive.com';
  placeholders.primary_color = convertToHex(settings.primary_color);
  placeholders.secondary_color = convertToHex(settings.secondary_color);
  const htmlContent = replacePlaceholders(emailTemplate.htmlContent, placeholders);
  let emailData = {
    to: toemail,
    subject: subject ?? emailTemplate.name,
    html: htmlContent
  }
  switch (provider) {
    case "mail_gun":
    case "mailgun":
      return sendWithMailgun(emailData, fromEmail, settings);
    case "brevo":
      return sendWithBrevo(emailData, fromEmail, settings);
    default:
      throw new Error(`Unsupported email provider: ${provider || 'not configured'}`);
  }
}

async function sendWithMailgun(emailData, fromEmail, settings) {
  if (!settings.email_api_key || !settings.email_mailgun_domain) {
    throw new Error("Mailgun API key and domain not configured");
  }

  const formData = new URLSearchParams();
  formData.append('from', fromEmail);
  formData.append('to', emailData.to);
  formData.append('subject', emailData.subject);
  formData.append('html', emailData.html);
  if (emailData.text) {
    formData.append('text', emailData.text);
  }

  const response = await fetch(`https://api.mailgun.net/v3/${settings.email_mailgun_domain}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`api:${settings.email_api_key}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  console.log("Mailgun response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mailgun error (${response.status}): ${errorText}`);
  }
}

async function sendWithBrevo(emailData, fromEmail, settings) {
  if (!settings.email_api_key) {
    throw new Error("Brevo API key not configured");
  }

  // Parse from email to get name and address
  let senderName = settings.email_from_name || 'No Reply';
  let senderEmail = fromEmail ?? settings.email_from_address;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': settings.email_api_key,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: senderName,
        email: senderEmail,
      },
      replyTo: {
        email: "tokshop254@gmail.com",
        name: "Tokshop Support",
      },
      to: [{ email: emailData.to }],
      subject: emailData.subject,
      htmlContent: emailData.html,
      textContent: emailData.text || undefined,
    }),
  });

  console.log("Brevo response status:", response.status);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Brevo error (${response.status}): ${errorData.message || JSON.stringify(errorData)}`);
  }
}

module.exports = { sendEmail };