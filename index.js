
require('dotenv').config();
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const open = require('open');
const basicAuth = require('express-basic-auth');
const bodyParser = require('body-parser');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = 3000;

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = 'token.json';

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let drive;

app.use(
  basicAuth({
    users: { [process.env.USERNAME]: process.env.PASSWORD },
    challenge: true,
    unauthorizedResponse: 'Unauthorized',
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

async function authorize() {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oauth2Client.setCredentials(token);
    drive = google.drive({ version: 'v3', auth: oauth2Client });
  } else {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log(`🔑 Authorize this app: ${authUrl}`);
    await open(authUrl);
  }
}

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  drive = google.drive({ version: 'v3', auth: oauth2Client });
  res.send('✅ Authorization successful. You can now use the app.');
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const fileMetadata = { name: req.file.originalname };
    const media = {
      mimeType: req.file.mimetype,
      body: Buffer.from(req.file.buffer),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    res.send(`✅ File uploaded: <a href="${file.data.webViewLink}" target="_blank">Open in Drive</a>`);
  } catch (error) {
    console.error(error);
    res.status(500).send('❌ Upload failed');
  }
});

app.get('/files', async (req, res) => {
  try {
    const response = await drive.files.list({
      pageSize: 20,
      fields: 'files(id, name, mimeType, webViewLink)',
    });
    const files = response.data.files;
    let html = '<h2>📁 Files in Google Drive</h2><ul>';
    files.forEach(f => {
      html += `<li><a href="${f.webViewLink}" target="_blank">${f.name}</a></li>`;
    });
    html += '</ul>';
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Could not list files');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at: http://localhost:${PORT}`);
  authorize();
});
