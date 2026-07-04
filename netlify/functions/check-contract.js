const { getStore } = require('@netlify/blobs');

const BLOBS_CONFIG = {
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_BLOBS_TOKEN
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const jobId = (event.queryStringParameters && event.queryStringParameters.jobId || '').toString().slice(0, 64);
  if (!jobId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  try {
    const store = getStore({ name: 'contract-jobs', ...BLOBS_CONFIG });
    const raw = await store.get(jobId).catch(() => null);

    if (!raw) {
      return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pending' }) };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = { status: 'error', error: 'Corrupted result, try generating again.' };
    }

    // Clean up once the client has a terminal result, no need to keep it around.
    if (parsed.status === 'done' || parsed.status === 'error') {
      store.delete(jobId).catch(() => {});
    }

    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
