// Link-in-bio contact form -> emails the submission to hello@thrivingcolibri.ai via Resend.
//
// Public, unauthenticated endpoint, so keep it cheap and abuse-resistant:
//   - honeypot field ("company") that real users never see; bots fill it -> silently dropped
//   - required-field + basic email validation
//   - length caps so a bot can't post a novel
//
// Mirrors the Resend setup in stripe-webhook.js: same verified sender domain
// (hello@thrivingcolibri.ai) and the same RESEND_API_KEY Vercel env var. Dependency-free:
// uses global fetch (Node 18+; this project runs Node 24.x).

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const data =
      req.body && typeof req.body === 'object' ? req.body : JSON.parse(await readRaw(req));

    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim();
    const phone = String(data.phone || '').trim();
    const message = String(data.message || '').trim();
    const honeypot = String(data.company || '').trim(); // hidden field; only bots fill it

    // Bot caught by the honeypot: pretend success so it doesn't retry, send nothing.
    if (honeypot) {
      res.status(200).json({ ok: true });
      return;
    }

    // Time-trap: a real person takes seconds to fill the form; a script fires near-instantly.
    // The page stamps how long the form was on screen; reject anything implausibly fast.
    const elapsed = Number(data.elapsed);
    if (!Number.isFinite(elapsed) || elapsed < 2000) {
      res.status(400).json({ ok: false, error: 'That came through a bit fast. Please wait a moment and try again.' });
      return;
    }

    if (!name || !email || !message) {
      res.status(400).json({ ok: false, error: 'Please add your name, email and a message.' });
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ ok: false, error: "That email doesn't look right." });
      return;
    }
    if (name.length > 200 || email.length > 200 || phone.length > 60 || message.length > 5000) {
      res.status(400).json({ ok: false, error: 'That is a bit long, try trimming it down.' });
      return;
    }

    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) {
      console.error('Missing RESEND_API_KEY');
      res.status(500).json({ ok: false, error: 'Server not configured' });
      return;
    }

    // Sender set in code (controlled here, like the webhook). hello@thrivingcolibri.ai is the
    // Resend-verified domain; reply_to is the submitter so a reply goes straight back to them.
    const FROM = 'Tamas Mihaly 🧭 <hello@thrivingcolibri.ai>';
    const TO = 'hello@thrivingcolibri.ai';
    const { subject, html, text } = buildEmail({ name, email, phone, message });

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [TO], reply_to: email, subject, html, text }),
    });

    if (!resp.ok) {
      console.error('Resend failed', resp.status, await resp.text());
      res.status(502).json({ ok: false, error: 'Could not send. Please email me directly.' });
      return;
    }

    console.log(`Contact form: message from ${email}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact error', err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please email me directly.' });
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

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildEmail({ name, email, phone, message }) {
  const when = new Date().toUTCString();
  const subject = `📬 New link-in-bio message from ${name}`;
  const row = (k, v) =>
    `<tr><td style="padding:3px 18px 3px 0;color:#6b7280;">${k}</td><td style="padding:3px 0;color:#1a202c;font-weight:bold;">${v}</td></tr>`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a202c;">
  <p style="font-size:20px;font-weight:bold;margin:0 0 2px;">📬 New message</p>
  <p style="margin:0 0 16px;color:#6b7280;">From your tamasmihaly.ai link-in-bio</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    ${row('Name', esc(name))}
    ${row('Email', esc(email))}
    ${phone ? row('Phone', esc(phone)) : ''}
    ${row('When', when)}
  </table>
  <p style="margin:16px 0 6px;color:#6b7280;">Message</p>
  <p style="margin:0;white-space:pre-wrap;">${esc(message)}</p>
  <p style="margin:18px 0 0;color:#9aa3b2;font-size:13px;">Reply straight to this email to get back to ${esc(name)}.</p>
</div>`;
  const text = `New link-in-bio message

Name:  ${name}
Email: ${email}
${phone ? `Phone: ${phone}\n` : ''}When:  ${when}

Message:
${message}

(Reply to this email to respond to ${name}.)`;
  return { subject, html, text };
}
