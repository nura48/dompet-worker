// Cloudflare Worker — Gemini API Proxy (GRATIS, tidak perlu kartu kredit)
// Ganti isi worker.js di GitHub dengan kode ini, lalu retry deploy

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

    if (!body.imageBase64 || !body.mediaType) {
      return jsonResponse({ error: 'Missing imageBase64 or mediaType' }, 400);
    }

    if (body.imageBase64.length > 5 * 1024 * 1024) {
      return jsonResponse({ error: 'Image too large (max 5MB)' }, 400);
    }

    // Gemini 1.5 Flash — gratis 15 req/menit, 1500 req/hari
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiBody = {
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: body.mediaType,
              data: body.imageBase64
            }
          },
          {
            text: `Kamu adalah asisten yang membaca foto nota/struk belanja/bukti transfer pembayaran.
Ekstrak informasi dari gambar ini dan balas HANYA dalam format JSON berikut, tanpa teks lain, tanpa markdown, tanpa backtick:
{"nominal":number,"deskripsi":"string max 60 karakter","kategori":"makan|minum|transport|belanja|tagihan|kesehatan|hiburan|lainnya","tanggal":"YYYY-MM-DD atau null","catatan":"string atau null"}

Aturan:
- nominal: angka saja tanpa titik/koma (contoh: 19000 bukan 19.000)
- deskripsi: ringkas isi nota (contoh: "Transfer ke Ade Faizal", "Makan siang warteg")
- kategori: pilih yang paling sesuai dari daftar yang ada
- tanggal: format YYYY-MM-DD, isi null jika tidak ada tanggal di nota
- catatan: info tambahan penting, null jika tidak ada
- Jika ini bukti transfer: nominal = jumlah transfer, deskripsi = "Transfer ke [nama penerima]"
- Jika gambar bukan nota/struk: isi nominal 0, deskripsi "Bukan nota"

Balas JSON saja, tidak ada teks lain sama sekali.`
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 300
      }
    };

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return jsonResponse({ error: 'Gemini API error: ' + geminiRes.status, detail: err }, 502);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    // Bersihkan markdown kalau ada
    let clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch { return jsonResponse({ error: 'Failed to parse response', raw: rawText }, 500); }
      } else {
        return jsonResponse({ error: 'No JSON in response', raw: rawText }, 500);
      }
    }

    // Pastikan nominal adalah angka
    if (typeof parsed.nominal === 'string') {
      parsed.nominal = parseFloat(parsed.nominal.replace(/[^0-9.]/g, '')) || 0;
    }

    return jsonResponse({ success: true, data: parsed });

  } catch (err) {
    return jsonResponse({ error: err.message || 'Internal error' }, 500);
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
