const crypto = require('crypto');

export default async function handler(req, res) {
  // Only allow POST requests (which is what Razorpay sends)
  if (req.method === 'POST') {
    // This is the secret password you will create in Vercel later
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Razorpay sends a signature in the headers to prove it's really them
    const signature = req.headers['x-razorpay-signature'];

    try {
      // Validate the signature
      const body = JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

      if (expectedSignature === signature) {
        console.log("✅ Payment Verified!", req.body.payload.payment.entity);
        
        // TODO: Later we will add the code here to tell your Telegram bot
        // to upgrade the user!

        // Tell Razorpay we received it successfully
        res.status(200).json({ status: 'ok' });
      } else {
        console.log("❌ Invalid signature. Hacker attack?");
        res.status(400).json({ status: 'error', message: 'Invalid signature' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ status: 'error', message: 'Server Error' });
    }
  } else {
    res.status(405).json({ message: 'Method Not Allowed' });
  }
}
