require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post('/api/generate', async (req, res) => {
  const { siteName, siteType, description, colorScheme, tone, designStyle, sections, address, phone, hours, sns } = req.body;

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

  const prompt = `世界トップクラスのWebデザイナーとして、以下の情報で高品質なHTMLファイルを1つ生成してください。

サイト名: ${siteName}
種類: ${siteType || 'ビジネスサイト'}
説明: ${description}
カラー: ${colorScheme || 'プロフェッショナル'}
トーン・雰囲気: ${tone || 'フォーマル・信頼感'}
デザインスタイル: ${designStyle || 'モダン・スタイリッシュ'}
実装するセクション（この順番で）: ${sectionList}
${detailLines ? `実際の店舗情報（コンテンツに使うこと）: ${detailLines}` : ''}

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

HTMLのみ出力。\`\`\`不要。<!DOCTYPE html>から始めること。`;

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});
