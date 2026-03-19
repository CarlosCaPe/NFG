const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const imagePath = process.argv[2];
const prompt = process.argv[3] || 'Describe in detail all visible text, labels, sticky notes, diagrams, and content on this board. Extract every readable text element.';

if (!imagePath || !fs.existsSync(imagePath)) {
  console.error(`Usage: node analyze-image.js <image-path> [prompt]`);
  process.exit(1);
}

// Get auth token from gh CLI
let token;
try {
  token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
} catch {
  console.error('Cannot get gh auth token. Run: gh auth login');
  process.exit(1);
}

// Read image and convert to base64
const imageBuffer = fs.readFileSync(imagePath);
const base64Image = imageBuffer.toString('base64');
const ext = path.extname(imagePath).toLowerCase().replace('.', '');
const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';

const payload = JSON.stringify({
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`,
            detail: 'high',
          },
        },
      ],
    },
  ],
  max_tokens: 4096,
});

const options = {
  hostname: 'models.inference.ai.azure.com',
  path: '/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(payload),
  },
};

console.log(`Analyzing: ${imagePath} (${(imageBuffer.length / 1024).toFixed(0)} KB)`);
console.log(`Prompt: ${prompt.substring(0, 100)}...`);
console.log('Calling GPT-4o via GitHub Models...\n');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`API Error ${res.statusCode}: ${data.substring(0, 500)}`);
      process.exit(1);
    }
    try {
      const json = JSON.parse(data);
      const content = json.choices?.[0]?.message?.content || 'No content returned';
      console.log(content);
    } catch (e) {
      console.error('Parse error:', e.message);
      console.error(data.substring(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
