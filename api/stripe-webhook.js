// Stripe payment -> deliver the Humanize Kit by email.
//
// Flow: Stripe sends a `checkout.session.completed` webhook here. We DON'T trust the
// request body for anything except the event id: we re-fetch the event from Stripe's
// API with our key, so a forged request can't trigger a delivery. If it's a real, paid
// checkout, we email the buyer the download link via Resend.
//
// Dependency-free: uses global fetch (Node 18+; this project runs Node 24.x).
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY  - a restricted key with READ access to "Events"
//   RESEND_API_KEY     - Resend API key
//   DOWNLOAD_URL       - the hosted zip link (e.g. a Google Drive "anyone with link" URL)
//   DELIVERY_FROM      - optional, the From address. Defaults to Resend's test sender,
//                        which only delivers to your own Resend account email until you
//                        verify tamasmihaly.ai in Resend.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const body =
      req.body && typeof req.body === 'object' ? req.body : JSON.parse(await readRaw(req));
    const eventId = body && body.id;
    const eventType = body && body.type;

    // Acknowledge anything that isn't a completed checkout so Stripe stops retrying.
    if (eventType !== 'checkout.session.completed') {
      res.status(200).json({ received: true, ignored: eventType || 'unknown' });
      return;
    }

    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const DOWNLOAD_URL = process.env.DOWNLOAD_URL;
    // Sender set in code (controlled here, not via a Vercel env var).
    // hello@thrivingcolibri.ai is the Resend-verified domain; replies land in that inbox natively.
    const FROM = 'Tamas Mihaly 🧭 <hello@thrivingcolibri.ai>';
    const REPLY_TO = process.env.DELIVERY_REPLY_TO; // optional override

    if (!STRIPE_KEY || !RESEND_KEY || !DOWNLOAD_URL) {
      console.error('Missing env vars', {
        stripe: !!STRIPE_KEY,
        resend: !!RESEND_KEY,
        download: !!DOWNLOAD_URL,
      });
      res.status(500).send('Server not configured');
      return;
    }

    // Re-fetch the event from Stripe to confirm it's genuine.
    const evResp = await fetch(`https://api.stripe.com/v1/events/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    });
    if (!evResp.ok) {
      console.error('Stripe verify failed', eventId, evResp.status);
      res.status(400).send('Could not verify event');
      return;
    }

    const event = await evResp.json();
    const session = event && event.data && event.data.object;
    if (!session || session.payment_status !== 'paid') {
      res.status(200).json({ received: true, note: 'not a paid session' });
      return;
    }

    const email = session.customer_details && session.customer_details.email;
    if (!email) {
      console.error('No customer email on session', session.id);
      res.status(200).json({ received: true, note: 'no email on session' });
      return;
    }

    const sendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        subject: 'Your Humanize Kit is here',
        html: deliveryEmail(DOWNLOAD_URL),
      }),
    });

    if (!sendResp.ok) {
      const detail = await sendResp.text();
      console.error('Resend failed', sendResp.status, detail);
      res.status(500).send('Email send failed');
      return;
    }

    console.log('Delivered Humanize Kit to', email);
    res.status(200).json({ received: true, delivered: true });
  } catch (err) {
    console.error('Webhook error', err);
    res.status(500).send('Webhook error');
  }
};

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data || '{}'));
    req.on('error', reject);
  });
}

function deliveryEmail(downloadUrl) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a202c;max-width:560px;margin:0 auto;padding:8px 4px;line-height:1.6;">
  <p style="font-size:16px;margin:0 0 16px;">Thanks for getting the Humanize Kit. Here it is.</p>
  <p style="margin:24px 0;">
    <a href="${downloadUrl}" style="background:#00bcd4;color:#04222a;font-weight:700;text-decoration:none;padding:14px 26px;border-radius:10px;display:inline-block;font-size:16px;">Download the Humanize Kit</a>
  </p>
  <p style="font-size:16px;margin:0 0 16px;">Open the manual first. It's in the download, and it walks you through setting it up in Claude Code, Codex, the Claude app or ChatGPT, then capturing your voice. The short video does the same if you'd rather watch.</p>
  <p style="font-size:16px;margin:0 0 6px;">Two things worth knowing:</p>
  <ul style="font-size:16px;padding-left:20px;margin:0 0 16px;">
    <li style="margin-bottom:8px;">Capture your voice first. Give it a few things you actually wrote. That's what makes the rewrite sound like you.</li>
    <li style="margin-bottom:8px;">The rewrite works on any plan. The score runs a small script, so that part needs a paid Claude or ChatGPT.</li>
  </ul>
  <p style="font-size:16px;margin:0 0 16px;">You get every update for life, so when I improve the kit you get the new version.</p>
  <p style="font-size:16px;margin:0 0 16px;">If anything's not working, just reply to this email. It comes straight to me.</p>
  <p style="font-size:16px;margin:24px 0 0;">Tamas</p>
</div>`;
}
