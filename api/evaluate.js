export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  // Always use the most reliable free model
  const SAFE_MODEL = 'llama-3.1-8b-instant';

  const { systemPrompt, userInput, expected, aiResponse, mode, failedCases } = req.body;

  try {

    // ── MODE: respond ──────────────────────────────────────────
    if (mode === 'respond') {
      if (!systemPrompt || !userInput) {
        return res.status(400).json({ error: 'systemPrompt and userInput required' });
      }
      const text = await groq(GROQ_API_KEY, SAFE_MODEL, [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userInput }
      ], 600, 0.3);
      return res.status(200).json({ aiResponse: text });
    }

    // ── MODE: judge ────────────────────────────────────────────
    if (mode === 'judge') {
      if (!userInput || !expected || !aiResponse) {
        return res.status(400).json({ error: 'userInput, expected, aiResponse required' });
      }
      const text = await groq(GROQ_API_KEY, SAFE_MODEL, [
        { role: 'system', content: 'You are a fair evaluator. Respond with JSON only. No markdown.' },
        { role: 'user', content: 
          'Does this AI response meet the expected behavior?\n\n' +
          'INPUT: ' + userInput + '\n' +
          'EXPECTED: ' + expected + '\n' +
          'AI RESPONSE: ' + aiResponse + '\n\n' +
          'Reply with JSON: {"verdict":"pass","feedback":"reason"}\n' +
          'Use pass if response addresses the main expected behavior.\n' +
          'Use partial if it misses something important.\n' +
          'Use fail only if completely wrong or ignores the question.\n' +
          'Be generous - judge on substance not exact wording.'
        }
      ], 200, 0);

      const clean = text.replace(/```json|```/g, '').trim();
      let result;
      try {
        result = JSON.parse(clean);
      } catch {
        // Manual extraction fallback
        const v = clean.includes('"pass"') ? 'pass' : clean.includes('"fail"') ? 'fail' : 'partial';
        const fMatch = clean.match(/"feedback"\s*:\s*"([^"]+)"/);
        result = { verdict: v, feedback: fMatch ? fMatch[1] : 'Evaluated.' };
      }
      if (!['pass','partial','fail'].includes(result.verdict)) result.verdict = 'partial';
      return res.status(200).json(result);
    }

    // ── MODE: validate ─────────────────────────────────────────
    if (mode === 'validate') {
      if (!userInput || !expected) {
        return res.status(400).json({ error: 'userInput and expected required' });
      }
      const text = await groq(GROQ_API_KEY, SAFE_MODEL, [
        { role: 'system', content: 'You are a QA expert. Respond with JSON only. No markdown.' },
        { role: 'user', content:
          'Rate this test case quality.\n\n' +
          'INPUT: ' + userInput + '\n' +
          'EXPECTED: ' + expected + '\n\n' +
          'Reply with JSON: {"quality":"good","feedback":"reason"}\n' +
          'Use good if input is realistic and expected behavior is specific.\n' +
          'Use improve if vague or needs more detail.\n' +
          'Use invalid if contradictory or impossible.\n' +
          'Most realistic test cases should be good.'
        }
      ], 150, 0);

      const clean = text.replace(/```json|```/g, '').trim();
      let result;
      try {
        result = JSON.parse(clean);
      } catch {
        const q = clean.includes('"good"') ? 'good' : clean.includes('"invalid"') ? 'invalid' : 'improve';
        const fMatch = clean.match(/"feedback"\s*:\s*"([^"]+)"/);
        result = { quality: q, feedback: fMatch ? fMatch[1] : 'Test case evaluated.' };
      }
      if (!['good','improve','invalid'].includes(result.quality)) result.quality = 'improve';
      return res.status(200).json(result);
    }

    // ── MODE: suggest ──────────────────────────────────────────
    if (mode === 'suggest') {
      if (!systemPrompt || !failedCases) {
        return res.status(400).json({ error: 'systemPrompt and failedCases required' });
      }
      const summary = failedCases.slice(0, 4).map((r, i) =>
        (i+1) + '. Input: ' + r.input.substring(0,100) + ' | Expected: ' + r.expected.substring(0,100)
      ).join('\n');

      const text = await groq(GROQ_API_KEY, SAFE_MODEL, [
        { role: 'system', content: 'You are a prompt engineer. Return only the improved prompt text, nothing else.' },
        { role: 'user', content:
          'This system prompt is failing. Rewrite it to fix these failures.\n\n' +
          'ORIGINAL PROMPT:\n' + systemPrompt.substring(0, 600) + '\n\n' +
          'FAILED CASES:\n' + summary + '\n\n' +
          'Return ONLY the improved prompt text.'
        }
      ], 600, 0.4);
      return res.status(200).json({ aiResponse: text });
    }

    return res.status(400).json({ error: 'Invalid mode: ' + mode });

  } catch (err) {
    console.error('PromptProof error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function groq(apiKey, model, messages, maxTokens, temperature) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Groq ' + res.status + ': ' + errText.substring(0, 200));
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}
