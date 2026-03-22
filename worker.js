const ALLOWED_ORIGIN = '*';

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json();

    if (!body.imageBase64) {
      return jsonResponse({ error: 'Missing imageBase64' }, 400);
    }

    // Cek API key tersedia
    if (typeof GEMINI_API_KEY === 'undefined' || !GEMINI_API_KEY) {
      return jsonResponse({ error: 'GEMINI_API_KEY not set in Worker environment' }, 500);
    }

    const mediaType = (body.mediaType && body.mediaType.startsWith('image/'))
      ? body.mediaType
      : 'image/jpeg';

    // Resize — ambil max 600KB untuk hindari timeout
    let imageData = body.imageBase64;
    const MAX_B64 = 600000;
    if (imageData.length > MAX_B64) {
      imageData = imageData.substring(0, MAX_B64);
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const reqBody = {
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: mediaType,
              data: imageData
            }
          },
          {
            text: `Baca nota/struk/bukti bayar ini. Balas HANYA JSON tanpa teks lain:
{"nominal":number,"deskripsi":"max 60 char","kategori":"makan|minum|transport|belanja|tagihan|kesehatan|hiburan|lainnya","tanggal":"YYYY-MM-DD atau null","catatan":"string atau null"}
Aturan: nominal angka saja tanpa titik/koma. JSON saja tidak ada teks lain.`
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200
      }
    };

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    // Ambil response text dulu untuk debug
    const resText = await geminiRes.text();

    if (!geminiRes.ok) {
      // Kembalikan detail error supaya bisa dibaca
      let errDetail = resText.substring(0, 500);
      return jsonResponse({
        error: `Gemini API error: HTTP ${geminiRes.status}`,
        detail: errDetail
      }, 502);
    }

    let geminiData;
    try {
      geminiData = JSON.parse(resText);
    } catch {
      return jsonResponse({ error: 'Gemini response bukan JSON', raw: resText.substring(0, 200) }, 500);
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!rawText) {
      // Cek apakah ada block reason
      const blockReason = geminiData?.candidates?.[0]?.finishReason || geminiData?.promptFeedback?.blockReason || 'unknown';
      return jsonResponse({ error: 'Gemini tidak ada output', reason: blockReason }, 500);
    }

    // Bersihkan response
    let clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = { nominal: 0, deskripsi: 'Gagal parse', kategori: 'lainnya', tanggal: null, catatan: clean.substring(0, 100) };
        }
      } else {
        parsed = { nominal: 0, deskripsi: 'Tidak terbaca', kategori: 'lainnya', tanggal: null, catatan: null };
      }
    }

    // Pastikan nominal angka
    if (typeof parsed.nominal === 'string') {
      parsed.nominal = parseFloat(parsed.nominal.replace(/[^0-9.]/g, '')) || 0;
    }
    if (!parsed.nominal) parsed.nominal = 0;

    return jsonResponse({ success: true, data: parsed });

  } catch (err) {
    return jsonResponse({
      error: 'Worker exception: ' + (err.message || 'unknown'),
      stack: err.stack ? err.stack.substring(0, 300) : null
    }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    }
  });
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
