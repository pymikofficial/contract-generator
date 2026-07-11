#!/usr/bin/env node
// Smoke test for Contract Generator, run against the LIVE deployed site
// (not local dev), since it hits real Netlify Functions + Blobs + the real
// Anthropic API.
//
// Usage: node scripts/smoke-test.mjs [base_url]
// Default base_url: https://cosmik-contract-generator.netlify.app

const BASE_URL = process.argv[2] || 'https://cosmik-contract-generator.netlify.app';
const POLL_MS = 2000;
const MAX_POLLS = 45; // ~90s ceiling

function log(msg) { console.log(msg); }
function fail(msg) { console.log('FAIL: ' + msg); process.exitCode = 1; }
function pass(msg) { console.log('PASS: ' + msg); }

async function kickoffAndPoll(jobId, payload) {
  let kickoff;
  try {
    kickoff = await fetch(`${BASE_URL}/.netlify/functions/generate-contract-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, ...payload })
    });
  } catch (e) {
    return { error: `Could not reach generate-contract-background: ${e.message}` };
  }
  if (kickoff.status !== 202 && kickoff.status !== 200) {
    return { error: `Unexpected status from background function: ${kickoff.status}` };
  }

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    let res;
    try {
      res = await fetch(`${BASE_URL}/.netlify/functions/check-contract?jobId=${encodeURIComponent(jobId)}`);
    } catch (e) {
      continue;
    }
    const data = await res.json();
    if (data.status === 'done' || data.status === 'error') {
      return { record: data };
    }
  }
  return { error: 'Timed out after ~90s with no done/error status.' };
}

async function testJoiningLetter() {
  log('=== Joining letter, minimal real fields ===');
  const jobId = 'smoketest-joining-' + Date.now();

  const startedAt = Date.now();
  const { record, error } = await kickoffAndPoll(jobId, {
    contractType: 'joining',
    fields: [
      { label: 'Employee full name', value: 'Ananya Roy' },
      { label: 'Designation', value: 'Operations Associate' },
      { label: 'Start date', value: '1 August 2026' },
      { label: 'Monthly salary', value: 'INR 45,000' }
    ]
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (error) { fail(error); return; }
  if (record.status === 'error') { fail(`Server returned an error: ${record.error}`); return; }

  if (Number(elapsedSec) <= 90) pass(`Generated in ${elapsedSec}s (within 90s budget).`);
  else fail(`Took ${elapsedSec}s, over the 90s budget.`);

  const text = record.contractText || '';

  if (text.length > 200) pass(`Contract text has real substance (${text.length} chars).`);
  else fail(`Contract text looks too short to be a real draft (${text.length} chars).`);

  if (text.includes('Ananya Roy')) pass('Contract text includes the provided employee name.');
  else fail('Contract text does not include the provided employee name.');

  if (!text.includes('—')) pass('No em dash in the generated draft (house style, enforced by the system prompt).');
  else fail('Found an em dash in the generated draft.');

  if (!/```|<html|<div/i.test(text)) pass('No markdown fences or stray HTML leaked into the plain-text draft.');
  else fail('Found markdown fences or HTML in what should be a plain-text draft.');

  log('\n--- First 400 chars of the draft (for manual eyeballing) ---');
  log(text.slice(0, 400));
}

async function testEmptyFields() {
  log('\n=== Edge case (no fields provided) ===');
  const jobId = 'smoketest-empty-' + Date.now();

  const { record, error } = await kickoffAndPoll(jobId, {
    contractType: 'joining',
    fields: []
  });

  if (error) { fail(error); return; }

  if (record.status === 'error' && typeof record.error === 'string' && record.error.length > 0) {
    pass(`Empty submission handled cleanly: status=error, message="${record.error}"`);
  } else {
    fail(`Expected a clean error status for an empty submission, got: ${JSON.stringify(record)}`);
  }
}

async function main() {
  log(`Testing ${BASE_URL}\n`);
  await testJoiningLetter();
  await testEmptyFields();
}

main();
