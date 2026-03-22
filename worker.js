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

    // Auto-detect atau fallback ke jpeg
    const mediaType = body.mediaType && body.mediaType.startsWith('image/')
      ? body.mediaType
      : 'image/jpeg';

    // Compress jika terlalu besar — ambil max 800KB base64
    let imageData = body.imageBase64;
    if (imageData.length > 800000) {
      imageData = imageData.substring(0, 800000);
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiBody = {
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: mediaType,
              data: imageData
            }
          },
          {
            text: `Baca foto nota/struk/bukti bayar ini. Balas HANYA JSON ini tanpa teks lain:
{"nominal":number,"deskripsi":"max 60 char","kategori":"makan|minum|transport|belanja|tagihan|kesehatan|hiburan|lainnya","tanggal":"YYYY-MM-DD atau null","catatan":"string atau null"}

Aturan penting:
- nominal: angka saja tanpa titik/koma/Rp (19000 bukan Rp19.000)
- deskripsi: nama tempat atau isi pembelian singkat
- tanggal: dari nota jika ada, null jika tidak ada
- Jika tidak bisa baca: {"nominal":0,"deskripsi":"Tidak terbaca","kategori":"lainnya","tanggal":null,"catatan":null}

JSON saja, tidak ada teks lain.`
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256
      }
    };

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return jsonResponse({
        error: `Gemini error ${geminiRes.status}`,
        detail: errText.substring(0, 200)
      }, 502);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    // Bersihkan response
    let clean = rawText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = { nominal: 0, deskripsi: 'Gagal baca', kategori: 'lainnya', tanggal: null, catatan: rawText.substring(0, 100) };
        }
      } else {
        parsed = { nominal: 0, deskripsi: 'Gagal parse', kategori: 'lainnya', tanggal: null, catatan: null };
      }
    }

    // Pastikan nominal angka
    if (typeof parsed.nominal === 'string') {
      parsed.nominal = parseFloat(parsed.nominal.replace(/[^0-9.]/g, '')) || 0;
    }
    if (!parsed.nominal) parsed.nominal = 0;

    return jsonResponse({ success: true, data: parsed });

  } catch (err) {
    return jsonResponse({ error: err.message || 'Internal server error' }, 500);
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
