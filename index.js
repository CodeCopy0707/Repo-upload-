const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// Configuration
// ======================
const uploadDir = 'uploads';
const maxFileSize = 100 * 1024 * 1024; // 100MB
const maxFiles = 10;

// Create upload directory if not exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ======================
// Storage Configuration
// ======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${uniqueSuffix}-${sanitizedName}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: maxFileSize, files: maxFiles }
});

let fileHistory = [];
let activeConnections = 0;

// ======================
// Helper Functions
// ======================
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  const typeMap = {
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
    pdf: 'pdf', 
    doc: 'doc', docx: 'doc', 
    xls: 'sheet', xlsx: 'sheet',
    txt: 'text', csv: 'text', json: 'text', md: 'text',
    js: 'code', html: 'code', css: 'code'
  };
  return typeMap[ext] || 'file';
}

function getFileIcon(fileType) {
  const iconMap = {
    image: 'fa-file-image',
    pdf: 'fa-file-pdf',
    doc: 'fa-file-word',
    sheet: 'fa-file-excel',
    text: 'fa-file-alt',
    code: 'fa-file-code',
    file: 'fa-file'
  };
  return iconMap[fileType] || 'fa-file';
}

function logActivity(action, filename, req) {
  fileHistory.unshift({
    action,
    filename,
    timestamp: new Date().toISOString(),
    ip: req.ip || 'unknown'
  });
  
  // Keep history to last 1000 entries
  if (fileHistory.length > 1000) {
    fileHistory.pop();
  }
}

// ======================
// Middleware
// ======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Security middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  activeConnections++;
  next();
});

// ======================
// Routes
// ======================
app.get('/ping', (req, res) => res.send('pong'));

app.get('/', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error('Directory read error:', err);
      return res.status(500).send(renderError('Server error'));
    }

    const fileList = files.map(file => {
      try {
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath);
        const parts = file.split('-');
        const originalName = parts.slice(2).join('-');
        
        return {
          id: file,
          name: originalName,
          size: formatBytes(stats.size),
          uploaded: new Date(parseInt(parts[0])).toLocaleString(),
          type: getFileType(file),
          icon: getFileIcon(getFileType(file)),
          downloadUrl: `/download/${file}`,
          previewUrl: `/preview/${file}`,
          editUrl: `/edit/${file}`
        };
      } catch (e) {
        console.error('File processing error:', e);
        return null;
      }
    }).filter(file => file !== null);
    
    res.send(renderDashboard(fileList));
  });
});

app.post('/upload', upload.array('files', maxFiles), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send(renderError('No files uploaded'));
  }

  req.files.forEach(file => {
    logActivity('upload', file.originalname, req);
  });

  res.redirect('/');
});

app.get('/preview/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found'));
  }

  try {
    const fileType = getFileType(req.params.filename);
    const parts = req.params.filename.split('-');
    const originalName = parts.slice(2).join('-');
    
    if (fileType === 'image') {
      return res.send(renderImagePreview(req.params.filename, originalName));
    } else if (fileType === 'pdf') {
      return res.send(renderPDFPreview(req.params.filename, originalName));
    } else if (fileType === 'text' || fileType === 'code') {
      const content = fs.readFileSync(filePath, 'utf-8');
      return res.send(renderTextViewer(req.params.filename, originalName, content));
    } else {
      const stats = fs.statSync(filePath);
      return res.send(renderDefaultPreview(req.params.filename, originalName, stats.size));
    }
  } catch (e) {
    console.error('Preview error:', e);
    res.status(500).send(renderError('Error generating preview'));
  }
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  const parts = req.params.filename.split('-');
  const originalName = parts.slice(2).join('-');
  
  if (fs.existsSync(filePath)) {
    logActivity('download', originalName, req);
    res.download(filePath, originalName);
  } else {
    res.status(404).send(renderError('File not found'));
  }
});

app.get('/edit/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.send(renderFileEditor(req.params.filename, content));
    } catch (e) {
      res.status(500).send(renderError('Error reading file'));
    }
  } else {
    res.status(404).send(renderError('File not found'));
  }
});

app.post('/save/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, req.body.content);
      const parts = req.params.filename.split('-');
      const originalName = parts.slice(2).join('-');
      logActivity('edit', originalName, req);
      res.redirect('/');
    } catch (e) {
      res.status(500).send(renderError('Error saving file'));
    }
  } else {
    res.status(404).send(renderError('File not found'));
  }
});

app.post('/delete/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      const parts = req.params.filename.split('-');
      const originalName = parts.slice(2).join('-');
      logActivity('delete', originalName, req);
      res.redirect('/');
    } catch (e) {
      res.status(500).send(renderError('Error deleting file'));
    }
  } else {
    res.status(404).send(renderError('File not found'));
  }
});

app.post('/delete-multiple', (req, res) => {
  const filesToDelete = Array.isArray(req.body.files) ? req.body.files : [];
  
  filesToDelete.forEach(filename => {
    const filePath = path.join(uploadDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        const parts = filename.split('-');
        const originalName = parts.slice(2).join('-');
        logActivity('delete', originalName, req);
      } catch (e) {
        console.error(`Error deleting file ${filename}:`, e);
      }
    }
  });
  
  res.redirect('/');
});

app.get('/history', (req, res) => {
  res.send(renderHistory(fileHistory));
});

// ======================
// Rendering Functions
// ======================
function renderDashboard(files) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Server</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        // Bulk delete functionality
        document.getElementById('delete-selected').addEventListener('click', () => {
          const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked'))
            .map(checkbox => checkbox.value);
          
          if (selectedFiles.length === 0) {
            alert('Please select files to delete');
            return;
          }
          
          if (confirm('Are you sure you want to delete ' + selectedFiles.length + ' selected files?')) {
            fetch('/delete-multiple', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ files: selectedFiles })
            }).then(() => window.location.reload());
          }
        });
        
        // Select all checkbox
        document.getElementById('select-all').addEventListener('change', (e) => {
          document.querySelectorAll('.file-checkbox').forEach(checkbox => {
            checkbox.checked = e.target.checked;
          });
        });
        
        // Search functionality
        document.getElementById('search-input').addEventListener('input', (e) => {
          const searchTerm = e.target.value.toLowerCase();
          document.querySelectorAll('#file-list tr').forEach(row => {
            const fileName = row.querySelector('.file-name').textContent.toLowerCase();
            row.style.display = fileName.includes(searchTerm) ? '' : 'none';
          });
        });
      });
    </script>
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-3xl font-bold text-center mb-8">Advanced File Server</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <!-- Upload Panel -->
        <div class="md:col-span-1 bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold mb-4">Upload Files</h2>
          <form action="/upload" method="POST" enctype="multipart/form-data" class="flex flex-col">
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4 cursor-pointer"
                 onclick="document.getElementById('file-input').click()">
              <i class="fas fa-cloud-upload-alt text-4xl text-gray-400 mb-2"></i>
              <p class="text-gray-600">Click to browse or drag & drop files</p>
              <p class="text-sm text-gray-500 mt-2">Max ${maxFiles} files, ${formatBytes(maxFileSize)} each</p>
              <input type="file" id="file-input" name="files" multiple class="hidden">
            </div>
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
              <i class="fas fa-upload mr-2"></i> Upload Files
            </button>
          </form>
          
          <div class="mt-8">
            <h2 class="text-xl font-semibold mb-4">Server Status</h2>
            <div class="space-y-4">
              <div class="flex items-center p-3 bg-green-50 rounded-lg">
                <div class="h-3 w-3 bg-green-500 rounded-full mr-3"></div>
                <span class="font-medium">Online</span>
              </div>
              <div class="flex items-center">
                <i class="fas fa-microchip text-blue-500 text-xl w-8"></i>
                <div>
                  <p class="font-semibold">System</p>
                  <p class="text-sm text-gray-600">Port: ${PORT} | Files: ${files.length}</p>
                </div>
              </div>
              <div class="flex items-center">
                <i class="fas fa-history text-purple-500 text-xl w-8"></i>
                <div>
                  <p class="font-semibold">Activity</p>
                  <p class="text-sm text-gray-600">${fileHistory.length} actions logged</p>
                </div>
              </div>
              <a href="/history" class="block mt-4 text-blue-600 hover:text-blue-800 flex items-center">
                <i class="fas fa-list-alt mr-2"></i> View full history
              </a>
            </div>
          </div>
        </div>
        
        <!-- File Manager -->
        <div class="md:col-span-3 bg-white rounded-lg shadow-md p-6">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
            <h2 class="text-xl font-semibold mb-4 md:mb-0">File Manager</h2>
            <div class="flex space-x-3">
              <div class="relative">
                <input 
                  type="text" 
                  id="search-input"
                  placeholder="Search files..." 
                  class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
              </div>
              <button 
                id="delete-selected"
                class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center"
              >
                <i class="fas fa-trash mr-2"></i> Delete Selected
              </button>
            </div>
          </div>
          
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left w-10">
                    <input type="checkbox" id="select-all" class="rounded">
                  </th>
                  <th class="px-6 py-3 text-left">Name</th>
                  <th class="px-6 py-3 text-left">Type</th>
                  <th class="px-6 py-3 text-left">Size</th>
                  <th class="px-6 py-3 text-left">Uploaded</th>
                  <th class="px-6 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="file-list" class="bg-white divide-y divide-gray-200">
                ${files.length > 0 ? files.map(file => `
                <tr>
                  <td class="px-6 py-4">
                    <input type="checkbox" class="file-checkbox rounded" value="${file.id}">
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex items-center">
                      <i class="${file.icon} text-blue-500 mr-3"></i>
                      <span class="file-name">${file.name}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100">
                      ${file.type.toUpperCase()}
                    </span>
                  </td>
                  <td class="px-6 py-4">${file.size}</td>
                  <td class="px-6 py-4">${file.uploaded}</td>
                  <td class="px-6 py-4">
                    <div class="flex space-x-3">
                      <a href="${file.previewUrl}" class="text-blue-600 hover:text-blue-800" title="Preview">
                        <i class="fas fa-eye"></i>
                      </a>
                      <a href="${file.downloadUrl}" class="text-green-600 hover:text-green-800" title="Download">
                        <i class="fas fa-download"></i>
                      </a>
                      <a href="${file.editUrl}" class="text-yellow-600 hover:text-yellow-800" title="Edit">
                        <i class="fas fa-edit"></i>
                      </a>
                      <button onclick="if(confirm('Delete this file?')) window.location.href='/delete/${file.id}'" 
                        class="text-red-600 hover:text-red-800" title="Delete">
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
                `).join('') : `
                <tr>
                  <td colspan="6" class="px-6 py-12 text-center">
                    <i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i>
                    <p class="text-gray-500">No files uploaded yet</p>
                  </td>
                </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderImagePreview(filename, originalName) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">
          <i class="fas fa-image text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="text-blue-600 hover:text-blue-800 flex items-center">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-xl"></i>
          </a>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow-md p-4 flex justify-center">
        <img src="/download/${filename}" alt="${originalName}" class="max-w-full max-h-screen">
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderPDFPreview(filename, originalName) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">
          <i class="fas fa-file-pdf text-red-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="text-blue-600 hover:text-blue-800 flex items-center">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-xl"></i>
          </a>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <iframe 
          src="/download/${filename}" 
          class="w-full h-screen border-none"
        ></iframe>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderTextViewer(filename, originalName, content) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Text: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">
          <i class="fas fa-file-alt text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="text-blue-600 hover:text-blue-800 flex items-center">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/edit/${filename}" class="text-yellow-600 hover:text-yellow-800 flex items-center">
            <i class="fas fa-edit mr-1"></i> Edit
          </a>
          <a href="/" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-xl"></i>
          </a>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <pre class="p-4 overflow-auto max-h-screen">${content}</pre>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderFileEditor(filename, content) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit File</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">
          <i class="fas fa-edit text-yellow-500 mr-2"></i>
          Editing: ${filename.split('-').slice(2).join('-')}
        </h1>
        <div class="flex space-x-3">
          <a href="/preview/${filename}" class="text-blue-600 hover:text-blue-800 flex items-center">
            <i class="fas fa-eye mr-1"></i> Preview
          </a>
          <a href="/" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-xl"></i>
          </a>
        </div>
      </div>
      
      <form action="/save/${filename}" method="POST">
        <textarea 
          name="content" 
          rows="25" 
          class="w-full p-4 font-mono text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >${content}</textarea>
        <div class="mt-4 flex justify-end space-x-3">
          <a href="/preview/${filename}" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg">
            Cancel
          </a>
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
            Save Changes
          </button>
        </div>
      </form>
    </div>
  </body>
  </html>
  `;
}

function renderDefaultPreview(filename, originalName, size) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">
          <i class="${getFileIcon(getFileType(filename))} text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="text-blue-600 hover:text-blue-800 flex items-center">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times text-xl"></i>
          </a>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow-md p-8 text-center">
        <i class="${getFileIcon(getFileType(filename))} text-6xl text-gray-400 mb-4"></i>
        <h2 class="text-xl font-medium mb-2">${originalName}</h2>
        <p class="text-gray-600 mb-4">${formatBytes(size)} • ${path.extname(filename).toUpperCase().slice(1) || 'FILE'}</p>
        <p class="text-gray-500">Preview not available for this file type</p>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderHistory(history) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Activity History</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">
          <i class="fas fa-history text-purple-500 mr-2"></i>
          Activity History
        </h1>
        <a href="/" class="text-blue-600 hover:text-blue-800 flex items-center">
          <i class="fas fa-arrow-left mr-1"></i> Back to Files
        </a>
      </div>
      
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left">Action</th>
              <th class="px-6 py-3 text-left">File</th>
              <th class="px-6 py-3 text-left">Time</th>
              <th class="px-6 py-3 text-left">IP Address</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${history.map(entry => `
            <tr>
              <td class="px-6 py-4">
                <span class="px-3 py-1 inline-flex items-center text-xs font-semibold rounded-full ${
                  entry.action === 'upload' ? 'bg-green-100 text-green-800' :
                  entry.action === 'download' ? 'bg-blue-100 text-blue-800' :
                  entry.action === 'edit' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800'
                }">
                  <i class="fas ${
                    entry.action === 'upload' ? 'fa-upload' :
                    entry.action === 'download' ? 'fa-download' :
                    entry.action === 'edit' ? 'fa-edit' :
                    'fa-trash'
                  } mr-1"></i>
                  ${entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                </span>
              </td>
              <td class="px-6 py-4">${entry.filename}</td>
              <td class="px-6 py-4">${new Date(entry.timestamp).toLocaleString()}</td>
              <td class="px-6 py-4">${entry.ip}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderError(message) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg">
        <div class="flex">
          <div class="flex-shrink-0">
            <i class="fas fa-exclamation-circle text-red-500 text-2xl"></i>
          </div>
          <div class="ml-3">
            <h3 class="text-lg font-medium text-red-800">Error</h3>
            <div class="mt-2 text-red-700">
              <p>${message}</p>
            </div>
            <div class="mt-4">
              <a href="/" class="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200">
                <i class="fas fa-arrow-left mr-2"></i> Return to Dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ⚡️ Advanced File Server
  ========================
  🚀 Server running on port ${PORT}
  📁 File storage: ${path.join(__dirname, uploadDir)}
  ⏰ Auto-ping enabled
  `);
});
