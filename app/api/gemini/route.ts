// app/api/gemini/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { text, targetLang } = await req.json();

  if (!text || !targetLang) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY!;
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const prompt = `
Translate the following text accurately into ${targetLang}:
"""
${text}
"""
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();
    const translation =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Translation unavailable';

    return NextResponse.json({ translation });
  } catch (err) {
    console.error('Gemini translation error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
