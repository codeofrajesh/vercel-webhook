const crypto = require('crypto');

export default async function handler(req, res) {
  // Only allow POST requests (which is what Razorpay sends)
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Your Vercel environment variables
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // Razorpay sends a signature in the headers to prove it's really them
  const signature = req.headers['x-razorpay-signature'];

  try {
    // 1. Validate the signature (Stop Hackers/Fakes)
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.log("❌ Invalid signature. Hacker attack blocked.");
      return res.status(400).json({ status: 'error', message: 'Invalid signature' });
    }

    // --- 🟢 SIGNATURE VALID: EXTRACT THE DATA ---
    const event = req.body.event; 
    
    // Extract the payment details and the Telegram ID from the notes
    // (Razorpay places the entity in different spots depending on the event type)
    const paymentEntity = req.body.payload.payment ? req.body.payload.payment.entity : null;
    const paymentLinkId = req.body.payload.payment_link ? req.body.payload.payment_link.entity.id : 'N/A';
    
    // CRITICAL: This pulls the user's Telegram ID that you must attach when creating the link
    const telegramId = paymentEntity?.notes?.telegram_id || req.body.payload.payment_link?.entity?.notes?.telegram_id;

    console.log(`✅ Webhook Event Received: ${event}`);

    // --- 🔀 EVENT SWITCHBOARD ---
    switch (event) {
      
      case 'payment_link.paid':
      case 'payment.captured':
        console.log(`Processing successful payment for Telegram ID: ${telegramId}`);
        if (telegramId) {
          const amount = paymentEntity.amount / 100; // Convert paise back to rupees
          await sendTelegramMessage(
            telegramId, 
            `✅ *Payment Successful!*\n\n*Receipt:* \`${paymentEntity.id}\`\n*Amount:* ₹${amount}\n\n🚀 Your **Drunkeinstein Pro** subscription is now ACTIVE! Type /start to refresh.`
          );
        }
        // TODO: Add your database code here later to change User Status to "Pro = True"
        break;

      case 'payment.failed':
        if (telegramId) {
          await sendTelegramMessage(
            telegramId, 
            `❌ *Payment Failed*\n\n*Reason:* ${paymentEntity.error_description || 'Bank issue'}\n\nDon't worry, no money was deducted. Please click the link again to retry or try a different UPI app.`
          );
        }
        break;

      case 'payment.authorized':
        if (telegramId) {
          await sendTelegramMessage(
            telegramId, 
            `⏳ *Payment Pending...*\nWe are waiting for final confirmation from your bank. Please wait a moment.`
          );
        }
        break;

      case 'payment.dispute.created':
        // If a user tries to commit fraud (chargeback), alert YOU (the Admin), not them.
        const adminChatId = process.env.ADMIN_TELEGRAM_ID; 
        if (adminChatId) {
          await sendTelegramMessage(
            adminChatId, 
            `🚨 *FRAUD / DISPUTE ALERT*\n\n*Payment ID:* \`${paymentEntity.id}\`\n*Telegram ID:* \`${telegramId}\`\n\nThe user raised a dispute with their bank. Please ban this user and check Razorpay dashboard.`
          );
        }
        break;

      default:
        console.log(`Unhandled event type: ${event}`);
    }

    // 3. Always tell Razorpay "OK" so they know we got the message
    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({ status: 'error', message: 'Server Error' });
  }
}

// --- Helper Function: Send Messages via Telegram Bot API ---
async function sendTelegramMessage(chatId, text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    console.error("❌ TELEGRAM_BOT_TOKEN is missing in Vercel Settings!");
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}
