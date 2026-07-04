const { getStore } = require('@netlify/blobs');

const BLOBS_CONFIG = {
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_BLOBS_TOKEN
};

const DAILY_CAP = parseInt(process.env.DAILY_CAP || '20', 10);
const MODEL = 'claude-sonnet-4-6';

// Stateless in-memory cap. Resets on cold start, this is a soft brake to
// control API spend, not a hard guarantee.
let usageDate = new Date().toISOString().slice(0, 10);
let usageCount = 0;

function checkAndBumpUsage() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== usageDate) {
    usageDate = today;
    usageCount = 0;
  }
  if (usageCount >= DAILY_CAP) return false;
  usageCount += 1;
  return true;
}

const SYSTEM_PROMPTS = {
  joining: `You draft a formal employment joining/appointment letter from the fields the employer provides.
Write the complete letter as plain text, ready to print. No markdown, no headers with hash symbols, no code fences.
Use a formal but plain-language legal drafting style. Structure it as a real letter: date, employer letterhead line, salutation, numbered clauses covering everything the fields describe, and a signature block for both employer and employee at the end.
Only include clauses for fields that were actually provided, never invent details, amounts, or dates that were not given.
If a jurisdiction is specified, ground statutory references (e.g. gratuity, provident fund, notice period law) in that jurisdiction's norms. If no jurisdiction is given, keep statutory language generic and note where local law should be confirmed.
Never use em-dashes. Use commas, full stops, or the word "to" for ranges instead.
Output only the letter text, nothing before or after it.`,
  exit: `You draft a formal employee exit/separation agreement from the fields the employer provides.
Write the complete agreement as plain text, ready to print. No markdown, no headers with hash symbols, no code fences.
Use a formal but plain-language legal drafting style. Structure it as a real agreement: date, parties, numbered clauses covering everything the fields describe (separation terms, full and final settlement, post-employment obligations), and a signature block for both employer and employee at the end.
Only include clauses for fields that were actually provided, never invent details, amounts, or dates that were not given.
If a jurisdiction is specified, ground statutory references (e.g. gratuity, provident fund, TDS) in that jurisdiction's norms. If no jurisdiction is given, keep statutory language generic and note where local law should be confirmed.
Never use em-dashes. Use commas, full stops, or the word "to" for ranges instead.
Output only the agreement text, nothing before or after it.`
};

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 200, body: '' };
  }

  const jobId = (body.jobId || '').toString().slice(0, 64);
  if (!jobId) {
    return { statusCode: 200, body: '' };
  }

  const store = getStore({ name: 'contract-jobs', ...BLOBS_CONFIG });
  const contractType = body.contractType === 'exit' ? 'exit' : 'joining';
  const fields = Array.isArray(body.fields) ? body.fields : [];

  const cleanFields = fields
    .map((f) => ({
      label: (f.label || '').toString().trim().slice(0, 80),
      value: (f.value || '').toString().trim().slice(0, 800)
    }))
    .filter((f) => f.label && f.value);

  if (!cleanFields.length) {
    await store.set(jobId, JSON.stringify({ status: 'error', error: 'Fill in at least one field before generating.' }));
    return { statusCode: 200, body: '' };
  }
  if (cleanFields.length > 60) {
    await store.set(jobId, JSON.stringify({ status: 'error', error: 'Too many fields in one request.' }));
    return { statusCode: 200, body: '' };
  }

  if (!checkAndBumpUsage()) {
    await store.set(jobId, JSON.stringify({ status: 'error', error: 'Contract Generator has hit its free generation limit for now. Check back shortly.' }));
    return { statusCode: 200, body: '' };
  }

  const fieldText = cleanFields.map((f) => `${f.label}: ${f.value}`).join('\n');

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPTS[contractType],
        messages: [{ role: 'user', content: `Fields provided:\n\n${fieldText}` }]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      await store.set(jobId, JSON.stringify({ status: 'error', error: 'Upstream error: ' + errText.slice(0, 200) }));
      return { statusCode: 200, body: '' };
    }

    const data = await resp.json();
    const contractText = (data.content || []).map((b) => b.text || '').join('').trim();

    if (!contractText) {
      await store.set(jobId, JSON.stringify({ status: 'error', error: 'No text came back. Try again.' }));
      return { statusCode: 200, body: '' };
    }

    await store.set(jobId, JSON.stringify({ status: 'done', contractText }));
  } catch (err) {
    await store.set(jobId, JSON.stringify({ status: 'error', error: err.message }));
  }

  return { statusCode: 200, body: '' };
};
