const DAILY_CAP = parseInt(process.env.DAILY_CAP || '20', 10);
const MODEL = 'claude-sonnet-4-6';

// Stateless in-memory cap, same pattern as Fieldnote's generate.js.
// Resets on cold start, this is a soft brake to control API spend, not a hard guarantee.
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const contractType = body.contractType === 'exit' ? 'exit' : 'joining';
  const fields = Array.isArray(body.fields) ? body.fields : [];

  const cleanFields = fields
    .map((f) => ({
      label: (f.label || '').toString().trim().slice(0, 80),
      value: (f.value || '').toString().trim().slice(0, 800)
    }))
    .filter((f) => f.label && f.value);

  if (!cleanFields.length) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Fill in at least one field before generating.' }) };
  }
  if (cleanFields.length > 60) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Too many fields in one request.' }) };
  }

  if (!checkAndBumpUsage()) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Contract Generator has hit its free generation limit for now. Check back shortly.' })
    };
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
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Upstream error: ' + errText.slice(0, 200) }) };
    }

    const data = await resp.json();
    const contractText = (data.content || []).map((b) => b.text || '').join('').trim();

    if (!contractText) {
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No text came back. Try again.' }) };
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractText })
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
