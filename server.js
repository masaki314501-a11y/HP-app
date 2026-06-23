require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post('/api/generate', async (req, res) => {
  const { siteName, siteType, description, colorScheme, tone, designStyle, sections, address, phone, hours, sns, images } = req.body;

  if (!siteName || !description) {
    return res.status(400).json({ error: 'サイト名と説明は必須です' });
  }

  const sectionList = Array.isArray(sections) && sections.length > 0
    ? sections.join('、')
    : 'ヒーローバナー、サービス紹介、実績・数字、料金プラン、FAQ、お問い合わせ';

  const detailLines = [
    address && `住所: ${address}`,
    phone && `電話: ${phone}`,
    hours && `営業時間: ${hours}`,
    sns && `SNS: ${sns}`,
  ].filter(Boolean).join('　');

  const imageLines = Array.isArray(images) && images.length > 0
    ? images.map((img, i) => `  画像${i + 1}: ${img.url}  （説明: ${img.alt}）`).join('\n')
    : '';

  const prompt = `世界トップクラスのWebデザイナーとして、以下の情報で高品質なHTMLファイルを1つ生成してください。

サイト名: ${siteName}
種類: ${siteType || 'ビジネスサイト'}
説明: ${description}
カラー: ${colorScheme || 'プロフェッショナル'}
トーン・雰囲気: ${tone || 'フォーマル・信頼感'}
デザインスタイル: ${designStyle || 'モダン・スタイリッシュ'}
実装するセクション（この順番で）: ${sectionList}
${detailLines ? `実際の店舗情報（コンテンツに使うこと）: ${detailLines}` : ''}
${imageLines ? `\n使用するフリー画像URL（これらをimgタグのsrcに使うこと。alt属性も設定すること）:\n${imageLines}` : ''}

必須要件:
- トーンとデザインスタイルをデザイン全体に反映させること
- 指定セクションのみを実装（未指定は省略）
- 固定ナビ（スクロールで背景変化、ハンバーガーメニュー）
- Intersection Observerでスクロールフェードイン
- CSS変数でカラー管理、Google Fonts（Noto Sans JP必須）
- カードデザイン（shadow、角丸、ホバーtranslateY）
- 実績セクションがある場合カウントアップJS
- FAQがある場合アコーディオン（JS）
- 完全レスポンシブ（モバイル対応）
- 業種に合った具体的な日本語コンテンツ
- HTML・CSS・JSを1ファイルにまとめる
${imageLines ? '- 指定された画像URLを実際に<img src="...">として各セクションに適切に配置すること（提供した全画像を使い切ること）' : ''}

HTMLのみ出力。\`\`\`不要。<!DOCTYPE html>から始めること。${imageLines ? `

最重要・絶対遵守: 上で渡した画像URL（${images.length}枚）を1枚も省略せず、すべて<img src="...">タグの実際のsrc属性値として使用すること。自分で別の画像URLを考案したり、画像を省略したりしてはならない。` : ''}`;

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8000,
      temperature: 0.7,
      stream: true,
    });

    let fullHtml = '';

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullHtml += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    fullHtml = fullHtml.replace(/^```html\n?/, '').replace(/\n?```$/, '').trim();
    fullHtml = insertMissingImages(fullHtml, images);
    res.write(`data: ${JSON.stringify({ done: true, html: fullHtml })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'HP生成中にエラーが発生しました: ' + err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// AIが指示を無視して画像を使わなかった場合に、漏れた画像をギャラリーとして補完する
function insertMissingImages(html, images) {
  if (!Array.isArray(images) || images.length === 0) return html;
  const missing = images.filter(img => img.url && !html.includes(img.url));
  if (missing.length === 0) return html;

  const escapeAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const gallery = `
<section class="auto-photo-gallery" style="padding:60px 24px;text-align:center;">
  <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;max-width:1100px;margin:0 auto;">
${missing.map(img => `    <img src="${escapeAttr(img.url)}" alt="${escapeAttr(img.alt || '')}" style="width:280px;height:200px;object-fit:cover;border-radius:12px;">`).join('\n')}
  </div>
</section>
`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, gallery + '</body>') : html + gallery;
}

app.post('/api/edit', async (req, res) => {
  const { html, instruction, images } = req.body;
  if (!html || !instruction) {
    return res.status(400).json({ error: 'HTMLと修正指示は必須です' });
  }

  const imageLines = Array.isArray(images) && images.length > 0
    ? images.map((img, i) => `  画像${i + 1}: ${img.url}  （説明: ${img.alt}）`).join('\n')
    : '';

  const prompt = `あなたはプロのWebデザイナーです。以下のHTMLを指示に従って修正してください。

修正指示: ${instruction}

重要:
- 指示された箇所のみ修正し、それ以外は完全に保持すること
- HTMLのみ出力。\`\`\`不要。<!DOCTYPE html>から始めること
${imageLines ? `\n利用可能なフリー画像URL（指示に関連する場合はこれらを<img src="...">として使うこと。既存のimgタグは削除しないこと）:\n${imageLines}` : ''}

現在のHTML:
${html}`;

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8000,
      temperature: 0.3,
      stream: true,
    });

    let fullHtml = '';
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullHtml += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    fullHtml = fullHtml.replace(/^```html\n?/, '').replace(/\n?```$/, '').trim();
    fullHtml = insertMissingImages(fullHtml, images);
    res.write(`data: ${JSON.stringify({ done: true, html: fullHtml })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: '修正中にエラーが発生しました: ' + err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.get('/api/images', (req, res) => {
  res.sendFile(path.join(__dirname, 'images.json'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});
