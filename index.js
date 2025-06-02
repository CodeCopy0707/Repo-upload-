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
const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/json',
  'text/csv',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/javascript',
  'text/html',
  'text/css'
];

// ======================
// Storage Configuration
// ======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create directory if not exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original name preserved
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    cb(null, `${timestamp}-${uniqueSuffix}-${sanitizedName}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Validate file type
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}`), false);
  }
};

const upload = multer({ 
  storage,
  limits: { fileSize: maxFileSize, files: maxFiles },
  fileFilter
}).array('files', maxFiles);

// ======================
// Data Structures
// ======================
let fileHistory = [];
let activeConnections = 0;
let serverStartTime = new Date();

// ======================
// Helper Functions
// ======================
function formatBytes(bytes) {
  if (isNaN(bytes)) return '0 Bytes';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  const typeMap = {
    // Images
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
    // Documents
    pdf: 'pdf', doc: 'doc', docx: 'doc', xls: 'sheet', xlsx: 'sheet',
    ppt: 'slide', pptx: 'slide',
    // Text
    txt: 'text', csv: 'text', json: 'text', md: 'text', rtf: 'text',
    // Code
    js: 'code', jsx: 'code', ts: 'code', html: 'code', css: 'code',
    scss: 'code', py: 'code', java: 'code', cpp: 'code', cs: 'code',
    php: 'code', sh: 'code',
    // Archives
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
    gz: 'archive'
  };
  return typeMap[ext] || 'file';
}

function getFileIcon(fileType) {
  const iconMap = {
    image: 'fa-file-image',
    pdf: 'fa-file-pdf',
    doc: 'fa-file-word',
    sheet: 'fa-file-excel',
    slide: 'fa-file-powerpoint',
    text: 'fa-file-alt',
    code: 'fa-file-code',
    archive: 'fa-file-archive',
    file: 'fa-file'
  };
  return iconMap[fileType] || 'fa-file';
}

function getFileColor(fileType) {
  const colorMap = {
    image: 'text-yellow-500',
    pdf: 'text-red-500',
    doc: 'text-blue-500',
    sheet: 'text-green-500',
    slide: 'text-orange-500',
    text: 'text-gray-500',
    code: 'text-purple-500',
    archive: 'text-indigo-500',
    file: 'text-gray-400'
  };
  return colorMap[fileType] || 'text-gray-400';
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[^a-zA-Z0-9._-]/g, '');
}

function logActivity(action, filename, req) {
  const entry = {
    action,
    filename,
    timestamp: new Date().toISOString(),
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown'
  };
  
  fileHistory.unshift(entry); // Add to beginning for chronological order
  
  // Keep history to last 1000 entries
  if (fileHistory.length > 1000) {
    fileHistory.pop();
  }
}

// ======================
// Server Maintenance
// ======================
function selfPing() {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  
  fetch(`${protocol}://${host}/ping`)
    .then(res => {
      if (!res.ok) throw new Error(`Status ${res.status}`);
      console.log(`[${new Date().toISOString()}] Ping successful`);
    })
    .catch(err => {
      console.error('Ping failed:', err.message);
      // Attempt to restart server if ping fails multiple times
      if (process.env.AUTO_RESTART === 'true') {
        console.log('Attempting to restart server...');
        process.exit(1); // Let process manager restart
      }
    });
}

// Initialize ping interval
let pingInterval = setInterval(selfPing, 30000);

// Cleanup on exit
process.on('SIGINT', () => {
  clearInterval(pingInterval);
  process.exit(0);
});

// ======================
// Middleware
// ======================
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public', {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Security middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // Connection tracking
  activeConnections++;
  req.startTime = process.hrtime();
  
  res.on('finish', () => {
    activeConnections--;
    const duration = process.hrtime(req.startTime);
    console.log(`${req.method} ${req.path} - ${res.statusCode} [${(duration[0] * 1000 + duration[1] / 1e6).toFixed(2)}ms]`);
  });
  
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).send(renderError('An unexpected error occurred', true));
});

// ======================
// Routes
// ======================

// Health check endpoint
app.get('/ping', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({
    status: 'healthy',
    uptime: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
    memory: {
      rss: formatBytes(memoryUsage.rss),
      heapTotal: formatBytes(memoryUsage.heapTotal),
      heapUsed: formatBytes(memoryUsage.heapUsed),
      external: formatBytes(memoryUsage.external)
    },
    connections: activeConnections,
    files: fileHistory.length,
    serverTime: serverStartTime.toISOString()
  });
});

// Main dashboard
app.get('/', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error('Directory read error:', err);
      return res.status(500).send(renderError('Could not read files directory', true));
    }

    const fileStats = files.map(file => {
      try {
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath);
        const parts = file.split('-');
        const timestamp = parseInt(parts[0]);
        const originalName = parts.slice(2).join('-');
        
        return {
          id: file,
          name: originalName,
          size: stats.size,
          formattedSize: formatBytes(stats.size),
          uploaded: new Date(timestamp).toLocaleString(),
          modified: stats.mtime.toLocaleString(),
          type: getFileType(file),
          ext: path.extname(file).slice(1),
          icon: getFileIcon(getFileType(file)),
          color: getFileColor(getFileType(file)),
          downloadUrl: `/download/${file}`,
          previewUrl: `/preview/${file}`,
          editUrl: `/edit/${file}`
        };
      } catch (e) {
        console.error('Error processing file:', file, e);
        return null;
      }
    }).filter(Boolean);
    
    // Sort by upload time (newest first)
    fileStats.sort((a, b) => b.size - a.size);
    
    // Calculate storage usage
    const totalSize = fileStats.reduce((sum, file) => sum + file.size, 0);
    const storageUsage = {
      total: formatBytes(totalSize),
      count: fileStats.length,
      breakdown: fileStats.reduce((acc, file) => {
        acc[file.type] = (acc[file.type] || 0) + 1;
        return acc;
      }, {})
    };
    
    res.send(renderDashboard(fileStats, storageUsage));
  });
});

// File upload handler
app.post('/upload', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).send(renderError('File too large (max 100MB)', false));
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).send(renderError('Too many files (max 10)', false));
      }
      if (err.message.includes('Invalid file type')) {
        return res.status(415).send(renderError('File type not allowed', false));
      }
      return res.status(500).send(renderError('Upload failed', true));
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).send(renderError('No files selected', false));
    }
    
    // Log each uploaded file
    req.files.forEach(file => {
      logActivity('upload', file.originalname, req);
    });
    
    res.redirect('/');
  });
});

// File preview handler
app.get('/preview/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found', false));
  }

  try {
    const stats = fs.statSync(filePath);
    const parts = req.params.filename.split('-');
    const originalName = parts.slice(2).join('-');
    const fileType = getFileType(req.params.filename);
    
    logActivity('preview', originalName, req);
    
    switch(fileType) {
      case 'image':
        return res.send(renderImagePreview(req.params.filename, originalName));
      case 'pdf':
        return res.send(renderPDFPreview(req.params.filename, originalName));
      case 'text':
      case 'code':
        const content = fs.readFileSync(filePath, 'utf-8');
        return res.send(renderTextViewer(req.params.filename, originalName, content));
      default:
        return res.send(renderDefaultPreview(req.params.filename, originalName, stats.size));
    }
  } catch (e) {
    console.error('Preview error:', e);
    res.status(500).send(renderError('Error generating preview', true));
  }
});

// File download handler
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found', false));
  }

  try {
    const parts = req.params.filename.split('-');
    const originalName = parts.slice(2).join('-');
    
    logActivity('download', originalName, req);
    
    res.download(filePath, originalName, (err) => {
      if (err) {
        console.error('Download error:', err);
        if (!res.headersSent) {
          res.status(500).send(renderError('Download failed', true));
        }
      }
    });
  } catch (e) {
    console.error('Download processing error:', e);
    res.status(500).send(renderError('Error processing download', true));
  }
});

// File editor handler
app.get('/edit/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found', false));
  }

  try {
    const parts = req.params.filename.split('-');
    const originalName = parts.slice(2).join('-');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    logActivity('edit_view', originalName, req);
    
    res.send(renderFileEditor(req.params.filename, originalName, content));
  } catch (e) {
    console.error('Edit error:', e);
    res.status(500).send(renderError('Error reading file', true));
  }
});

// File save handler
app.post('/save/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found', false));
  }

  if (!req.body.content) {
    return res.status(400).send(renderError('No content provided', false));
  }

  try {
    fs.writeFileSync(filePath, req.body.content);
    
    const parts = req.params.filename.split('-');
    const originalName = parts.slice(2).join('-');
    
    logActivity('edit_save', originalName, req);
    
    res.redirect('/');
  } catch (e) {
    console.error('Save error:', e);
    res.status(500).send(renderError('Error saving file', true));
  }
});

// File rename handler
app.post('/rename/:filename', (req, res) => {
  const oldPath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(oldPath)) {
    return res.status(404).send(renderError('File not found', false));
  }

  const newName = sanitizeInput(req.body.newName);
  if (!newName) {
    return res.status(400).send(renderError('Invalid file name', false));
  }

  try {
    const parts = req.params.filename.split('-');
    const timestamp = parts[0];
    const uniqueSuffix = parts[1];
    const newFilename = `${timestamp}-${uniqueSuffix}-${newName}`;
    const newPath = path.join(uploadDir, newFilename);
    
    fs.renameSync(oldPath, newPath);
    
    const originalName = parts.slice(2).join('-');
    logActivity('rename', `${originalName} → ${newName}`, req);
    
    res.redirect('/');
  } catch (e) {
    console.error('Rename error:', e);
    res.status(500).send(renderError('Error renaming file', true));
  }
});

// File delete handler
app.post('/delete/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found', false));
  }

  try {
    const parts = req.params.filename.split('-');
    const originalName = parts.slice(2).join('-');
    
    fs.unlinkSync(filePath);
    
    logActivity('delete', originalName, req);
    
    res.redirect('/');
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).send(renderError('Error deleting file', true));
  }
});

// Bulk delete handler
app.post('/delete-multiple', (req, res) => {
  if (!Array.isArray(req.body.files)) {
    return res.status(400).send(renderError('Invalid request', false));
  }

  const results = req.body.files.map(filename => {
    const filePath = path.join(uploadDir, filename);
    
    if (fs.existsSync(filePath)) {
      try {
        const parts = filename.split('-');
        const originalName = parts.slice(2).join('-');
        
        fs.unlinkSync(filePath);
        logActivity('delete', originalName, req);
        
        return { filename, status: 'deleted' };
      } catch (e) {
        console.error(`Error deleting ${filename}:`, e);
        return { filename, status: 'error', error: e.message };
      }
    } else {
      return { filename, status: 'not_found' };
    }
  });
  
  res.json({ results });
});

// Activity history
app.get('/history', (req, res) => {
  // Filter by action if query parameter provided
  const filteredHistory = req.query.action 
    ? fileHistory.filter(entry => entry.action === req.query.action)
    : fileHistory;
    
  // Limit to last 100 entries for performance
  const limitedHistory = filteredHistory.slice(0, 100);
  
  res.send(renderActivityHistory(limitedHistory));
});

// Server statistics
app.get('/stats', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Could not read directory' });
    }
    
    let totalSize = 0;
    const fileTypes = {};
    const fileExtensions = {};
    
    files.forEach(file => {
      try {
        const stats = fs.statSync(path.join(uploadDir, file));
        totalSize += stats.size;
        
        const type = getFileType(file);
        fileTypes[type] = (fileTypes[type] || 0) + 1;
        
        const ext = path.extname(file).toLowerCase().slice(1);
        if (ext) {
          fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
        }
      } catch (e) {
        console.error('Error processing file stats:', e);
      }
    });
    
    res.json({
      server: {
        startTime: serverStartTime.toISOString(),
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform
      },
      files: {
        total: files.length,
        totalSize: totalSize,
        formattedSize: formatBytes(totalSize),
        types: fileTypes,
        extensions: fileExtensions
      },
      activity: {
        totalActions: fileHistory.length,
        lastAction: fileHistory[0] || null,
        activeConnections
      },
      memory: process.memoryUsage(),
      load: process.cpuUsage()
    });
  });
});

// ======================
// Rendering Functions
// ======================
function renderDashboard(files, storageUsage) {
  const fileTypes = [...new Set(files.map(f => f.type))];
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Advanced File Server</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      .drop-zone {
        transition: all 0.3s ease;
      }
      .drop-zone.active {
        border-color: #3b82f6;
        background-color: #eff6ff;
      }
      .file-item:hover {
        background-color: #f8fafc;
      }
      .progress-bar {
        transition: width 0.3s ease;
      }
      @media (max-width: 768px) {
        .file-table-header {
          display: none;
        }
      }
    </style>
  </head>
  <body class="bg-gray-50">
    <div class="min-h-screen">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">
            <i class="fas fa-server text-blue-500 mr-2"></i>
            File Server
          </h1>
          <div class="flex items-center space-x-4">
            <a href="/history" class="text-gray-600 hover:text-gray-900">
              <i class="fas fa-history mr-1"></i> Activity
            </a>
            <a href="/stats" class="text-gray-600 hover:text-gray-900">
              <i class="fas fa-chart-bar mr-1"></i> Stats
            </a>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <main class="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <!-- Upload Section -->
        <div class="bg-white shadow rounded-lg p-6 mb-8">
          <h2 class="text-xl font-semibold mb-4 flex items-center">
            <i class="fas fa-cloud-upload-alt text-blue-500 mr-2"></i>
            Upload Files
          </h2>
          
          <form id="upload-form" action="/upload" method="POST" enctype="multipart/form-data" class="mb-4">
            <div id="drop-zone" class="drop-zone border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer mb-4">
              <i class="fas fa-file-upload text-4xl text-gray-400 mb-3"></i>
              <p class="text-gray-600 font-medium">Drag & drop files here</p>
              <p class="text-sm text-gray-500 mt-1">or click to browse (max ${maxFiles} files, ${formatBytes(maxFileSize)} each)</p>
              <input type="file" id="file-input" name="files" multiple class="hidden" />
            </div>
            
            <div id="file-list" class="mb-4 hidden">
              <h3 class="text-sm font-medium text-gray-700 mb-2">Selected Files:</h3>
              <ul id="selected-files" class="border rounded divide-y divide-gray-200 max-h-40 overflow-y-auto"></ul>
            </div>
            
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium flex items-center justify-center">
              <i class="fas fa-upload mr-2"></i> Upload Files
            </button>
          </form>
          
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="bg-gray-50 p-4 rounded-lg">
              <div class="flex items-center">
                <div class="bg-blue-100 p-3 rounded-full mr-3">
                  <i class="fas fa-database text-blue-600"></i>
                </div>
                <div>
                  <p class="text-sm text-gray-500">Total Storage</p>
                  <p class="font-semibold">${storageUsage.total}</p>
                </div>
              </div>
            </div>
            
            <div class="bg-gray-50 p-4 rounded-lg">
              <div class="flex items-center">
                <div class="bg-green-100 p-3 rounded-full mr-3">
                  <i class="fas fa-file text-green-600"></i>
                </div>
                <div>
                  <p class="text-sm text-gray-500">Total Files</p>
                  <p class="font-semibold">${storageUsage.count}</p>
                </div>
              </div>
            </div>
            
            <div class="bg-gray-50 p-4 rounded-lg">
              <div class="flex items-center">
                <div class="bg-purple-100 p-3 rounded-full mr-3">
                  <i class="fas fa-tasks text-purple-600"></i>
                </div>
                <div>
                  <p class="text-sm text-gray-500">Active Connections</p>
                  <p class="font-semibold">${activeConnections}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- File Browser -->
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center md:justify-between">
            <h2 class="text-xl font-semibold flex items-center">
              <i class="fas fa-folder-open text-blue-500 mr-2"></i>
              File Browser
            </h2>
            
            <div class="mt-2 md:mt-0 flex space-x-2">
              <div class="relative flex-grow max-w-xs">
                <input 
                  type="text" 
                  id="search-input"
                  placeholder="Search files..." 
                  class="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                >
                <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
              </div>
              
              <button 
                id="bulk-delete-btn"
                class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center whitespace-nowrap"
              >
                <i class="fas fa-trash mr-2"></i> Delete
              </button>
            </div>
          </div>
          
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr class="file-table-header">
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                    <input type="checkbox" id="select-all" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                  </th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded</th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody id="file-table-body" class="bg-white divide-y divide-gray-200">
                ${files.length > 0 ? files.map(file => `
                <tr class="file-item hover:bg-gray-50" data-name="${file.name.toLowerCase()}" data-type="${file.type}">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <input type="checkbox" class="file-checkbox rounded border-gray-300 text-blue-600 focus:ring-blue-500" value="${file.id}">
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex items-center">
                      <i class="${file.icon} ${file.color} text-lg mr-3"></i>
                      <div class="truncate max-w-xs">
                        <div class="text-sm font-medium text-gray-900 truncate">${file.name}</div>
                        <div class="text-xs text-gray-500">${file.ext ? file.ext.toUpperCase() : 'FILE'}</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${file.formattedSize}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${file.uploaded}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div class="flex space-x-3">
                      <a href="${file.previewUrl}" class="text-blue-600 hover:text-blue-900" title="Preview">
                        <i class="fas fa-eye"></i>
                      </a>
                      <a href="${file.downloadUrl}" class="text-green-600 hover:text-green-900" title="Download">
                        <i class="fas fa-download"></i>
                      </a>
                      <a href="${file.editUrl}" class="text-yellow-600 hover:text-yellow-900" title="Edit">
                        <i class="fas fa-edit"></i>
                      </a>
                      <button onclick="confirmDelete('${file.id}', '${file.name.replace(/'/g, "\\'")}')" class="text-red-600 hover:text-red-900" title="Delete">
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
                `).join('') : `
                <tr>
                  <td colspan="5" class="px-6 py-12 text-center">
                    <i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i>
                    <p class="text-gray-500">No files uploaded yet</p>
                    <p class="text-gray-400 text-sm mt-2">Upload files using the panel above</p>
                  </td>
                </tr>
                `}
              </tbody>
            </table>
          </div>
          
          ${files.length > 10 ? `
          <div class="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div class="flex-1 flex justify-between sm:hidden">
              <a href="#" class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                Previous
              </a>
              <a href="#" class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                Next
              </a>
            </div>
            <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p class="text-sm text-gray-700">
                  Showing <span class="font-medium">1</span> to <span class="font-medium">10</span> of <span class="font-medium">${files.length}</span> files
                </p>
              </div>
              <div>
                <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <a href="#" class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                    <span class="sr-only">Previous</span>
                    <i class="fas fa-chevron-left"></i>
                  </a>
                  <a href="#" aria-current="page" class="z-10 bg-blue-50 border-blue-500 text-blue-600 relative inline-flex items-center px-4 py-2 border text-sm font-medium">
                    1
                  </a>
                  <a href="#" class="bg-white border-gray-300 text-gray-500 hover:bg-gray-50 relative inline-flex items-center px-4 py-2 border text-sm font-medium">
                    2
                  </a>
                  <a href="#" class="bg-white border-gray-300 text-gray-500 hover:bg-gray-50 relative inline-flex items-center px-4 py-2 border text-sm font-medium">
                    3
                  </a>
                  <span class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                    ...
                  </span>
                  <a href="#" class="bg-white border-gray-300 text-gray-500 hover:bg-gray-50 relative inline-flex items-center px-4 py-2 border text-sm font-medium">
                    8
                  </a>
                  <a href="#" class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50">
                    <span class="sr-only">Next</span>
                    <i class="fas fa-chevron-right"></i>
                  </a>
                </nav>
              </div>
            </div>
          </div>
          ` : ''}
        </div>
      </main>
    </div>

    <!-- Delete Confirmation Modal -->
    <div id="delete-modal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div class="px-6 py-4 border-b">
          <h3 class="text-xl font-semibold">Confirm Delete</h3>
        </div>
        <div class="p-6">
          <p id="delete-message" class="mb-4">Are you sure you want to delete this file?</p>
          <div class="flex justify-end space-x-3">
            <button 
              onclick="document.getElementById('delete-modal').classList.add('hidden')"
              class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
            >
              Cancel
            </button>
            <a 
              id="confirm-delete-btn"
              href="#"
              class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
            >
              Delete
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Bulk Delete Confirmation Modal -->
    <div id="bulk-delete-modal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div class="px-6 py-4 border-b">
          <h3 class="text-xl font-semibold">Confirm Bulk Delete</h3>
        </div>
        <div class="p-6">
          <p id="bulk-delete-message" class="mb-4">Are you sure you want to delete the selected files?</p>
          <div class="flex justify-end space-x-3">
            <button 
              onclick="document.getElementById('bulk-delete-modal').classList.add('hidden')"
              class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
            >
              Cancel
            </button>
            <button 
              id="confirm-bulk-delete-btn"
              class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
            >
              Delete Selected
            </button>
          </div>
        </div>
      </div>
    </div>

    <script>
      // Drag and drop functionality
      const dropZone = document.getElementById('drop-zone');
      const fileInput = document.getElementById('file-input');
      const fileList = document.getElementById('file-list');
      const selectedFiles = document.getElementById('selected-files');
      const uploadForm = document.getElementById('upload-form');
      
      // Highlight drop zone when files are dragged over
      ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
      });
      
      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
      });
      
      function highlight(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('active');
      }
      
      function unhighlight(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('active');
      }
      
      // Handle dropped files
      dropZone.addEventListener('drop', handleDrop, false);
      dropZone.addEventListener('click', () => fileInput.click());
      
      function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        fileInput.files = files;
        updateFileList(files);
      }
      
      // Handle selected files
      fileInput.addEventListener('change', () => {
        updateFileList(fileInput.files);
      });
      
      function updateFileList(files) {
        if (files.length > 0) {
          fileList.classList.remove('hidden');
          selectedFiles.innerHTML = '';
          
          Array.from(files).forEach(file => {
            const li = document.createElement('li');
            li.className = 'px-4 py-2 flex justify-between items-center';
            
            const fileInfo = document.createElement('div');
            fileInfo.className = 'truncate';
            
            const fileName = document.createElement('p');
            fileName.className = 'text-sm font-medium truncate';
            fileName.textContent = file.name;
            
            const fileSize = document.createElement('p');
            fileSize.className = 'text-xs text-gray-500';
            fileSize.textContent = formatFileSize(file.size);
            
            fileInfo.appendChild(fileName);
            fileInfo.appendChild(fileSize);
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'text-red-500 hover:text-red-700';
            removeBtn.innerHTML = '<i class="fas fa-times"></i>';
            removeBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              li.remove();
              if (selectedFiles.children.length === 0) {
                fileList.classList.add('hidden');
              }
            };
            
            li.appendChild(fileInfo);
            li.appendChild(removeBtn);
            selectedFiles.appendChild(li);
          });
        } else {
          fileList.classList.add('hidden');
        }
      }
      
      function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
      }
      
      // File search functionality
      const searchInput = document.getElementById('search-input');
      searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        const rows = document.querySelectorAll('#file-table-body tr');
        
        rows.forEach(row => {
          const fileName = row.getAttribute('data-name');
          const fileType = row.getAttribute('data-type');
          
          if (fileName.includes(searchTerm) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      });
      
      // Bulk selection
      const selectAll = document.getElementById('select-all');
      const fileCheckboxes = document.querySelectorAll('.file-checkbox');
      
      selectAll.addEventListener('change', (e) => {
        fileCheckboxes.forEach(checkbox => {
          checkbox.checked = e.target.checked;
        });
      });
      
      // Bulk delete
      const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
      const bulkDeleteModal = document.getElementById('bulk-delete-modal');
      const confirmBulkDeleteBtn = document.getElementById('confirm-bulk-delete-btn');
      
      bulkDeleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked'));
        
        if (selected.length === 0) {
          alert('Please select files to delete');
          return;
        }
        
        document.getElementById('bulk-delete-message').textContent = 
          `Are you sure you want to delete ${selected.length} selected files?`;
        
        bulkDeleteModal.classList.remove('hidden');
      });
      
      confirmBulkDeleteBtn.addEventListener('click', () => {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked'))
          .map(checkbox => checkbox.value);
        
        fetch('/delete-multiple', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ files: selected })
        }).then(() => {
          bulkDeleteModal.classList.add('hidden');
          window.location.reload();
        });
      });
      
      // Single file delete confirmation
      function confirmDelete(fileId, fileName) {
        document.getElementById('delete-message').textContent = 
          `Are you sure you want to delete "${fileName}"?`;
        
        document.getElementById('confirm-delete-btn').href = `/delete/${fileId}`;
        document.getElementById('delete-modal').classList.remove('hidden');
      }
      
      // Close modals when clicking outside
      window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('delete-modal')) {
          document.getElementById('delete-modal').classList.add('hidden');
        }
        if (e.target === document.getElementById('bulk-delete-modal')) {
          document.getElementById('bulk-delete-modal').classList.add('hidden');
        }
      });
    </script>
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
    <title>Image Preview: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      .image-container {
        max-height: calc(100vh - 120px);
      }
      @media (max-width: 768px) {
        .image-container {
          max-height: calc(100vh - 160px);
        }
      }
    </style>
  </head>
  <body class="bg-gray-100">
    <div class="min-h-screen flex flex-col">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 class="text-lg font-medium text-gray-900 truncate max-w-xs">
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
      </header>

      <!-- Image Preview -->
      <main class="flex-grow flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-md p-2 max-w-full max-h-full">
          <img 
            src="/download/${filename}" 
            alt="${originalName}"
            class="max-w-full max-h-full object-contain image-container"
          >
        </div>
      </main>

      <!-- Footer -->
      <footer class="bg-white border-t py-2 px-4 text-center text-sm text-gray-500">
        Use mouse wheel or pinch to zoom. Drag to pan.
      </footer>
    </div>

    <script>
      // Basic image zoom and pan functionality
      const img = document.querySelector('img');
      let scale = 1;
      let posX = 0;
      let posY = 0;
      let isDragging = false;
      let startX, startY;
      
      img.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const rect = img.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.min(Math.max(0.5, scale * delta), 5);
        
        // Calculate new position to zoom toward mouse
        posX = offsetX - (offsetX - posX) * (newScale / scale);
        posY = offsetY - (offsetY - posY) * (newScale / scale);
        
        scale = newScale;
        applyTransform();
      });
      
      img.addEventListener('mousedown', (e) => {
        if (scale > 1) {
          isDragging = true;
          startX = e.clientX - posX;
          startY = e.clientY - posY;
          img.style.cursor = 'grabbing';
        }
      });
      
      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        posX = e.clientX - startX;
        posY = e.clientY - startY;
        applyTransform();
      });
      
      window.addEventListener('mouseup', () => {
        isDragging = false;
        img.style.cursor = scale > 1 ? 'grab' : 'default';
      });
      
      function applyTransform() {
        img.style.transform = \`translate(\${posX}px, \${posY}px) scale(\${scale})\`;
      }
    </script>
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
    <title>PDF Preview: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js"></script>
    <style>
      #pdf-container {
        height: calc(100vh - 120px);
      }
      #pdf-viewer {
        height: 100%;
        overflow: auto;
      }
      .pdf-page {
        margin-bottom: 20px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      .pdf-controls {
        background-color: rgba(255, 255, 255, 0.9);
      }
    </style>
  </head>
  <body class="bg-gray-100">
    <div class="min-h-screen flex flex-col">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 class="text-lg font-medium text-gray-900 truncate max-w-xs">
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
      </header>

      <!-- PDF Controls -->
      <div class="pdf-controls sticky top-0 z-10 bg-gray-50 border-b px-4 py-2 flex items-center justify-center space-x-4">
        <button id="prev-page" class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">
          <i class="fas fa-arrow-left mr-1"></i> Previous
        </button>
        <span class="text-sm">
          Page <span id="page-num">1</span> of <span id="page-count">0</span>
        </span>
        <button id="next-page" class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">
          Next <i class="fas fa-arrow-right ml-1"></i>
        </button>
        <span class="text-sm">
          Zoom: 
          <select id="zoom-select" class="ml-1 border rounded">
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1" selected>100%</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
          </select>
        </span>
      </div>

      <!-- PDF Viewer -->
      <main id="pdf-container" class="flex-grow overflow-auto">
        <div id="pdf-viewer" class="w-full flex flex-col items-center p-4"></div>
      </main>
    </div>

    <script>
      // Initialize PDF.js
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
      
      let pdfDoc = null;
      let currentPage = 1;
      let pageRendering = false;
      let pageNumPending = null;
      let scale = 1.0;
      
      // Load the PDF
      (function loadPdf() {
        const loadingTask = pdfjsLib.getDocument('/download/${filename}');
        
        loadingTask.promise.then(function(pdf) {
          pdfDoc = pdf;
          document.getElementById('page-count').textContent = pdf.numPages;
          
          // Render initial page
          renderPage(currentPage);
        }).catch(function(error) {
          console.error('PDF loading error:', error);
          alert('Error loading PDF');
        });
      })();
      
      // Render a page
      function renderPage(num) {
        pageRendering = true;
        document.getElementById('page-num').textContent = num;
        
        pdfDoc.getPage(num).then(function(page) {
          const viewport = page.getViewport({ scale: scale });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const container = document.getElementById('pdf-viewer');
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          // Clear previous pages
          if (num === 1) {
            container.innerHTML = '';
          }
          
          // Create page div
          const pageDiv = document.createElement('div');
          pageDiv.className = 'pdf-page';
          pageDiv.appendChild(canvas);
          container.appendChild(pageDiv);
          
          // Render PDF page
          const renderContext = {
            canvasContext: ctx,
            viewport: viewport
          };
          
          const renderTask = page.render(renderContext);
          renderTask.promise.then(function() {
            pageRendering = false;
            if (pageNumPending !== null) {
              renderPage(pageNumPending);
              pageNumPending = null;
            }
          });
        });
      }
      
      // Queue a page rendering
      function queueRenderPage(num) {
        if (pageRendering) {
          pageNumPending = num;
        } else {
          renderPage(num);
        }
      }
      
      // Previous page
      document.getElementById('prev-page').addEventListener('click', function() {
        if (currentPage <= 1) return;
        currentPage--;
        queueRenderPage(currentPage);
        window.scrollTo(0, 0);
      });
      
      // Next page
      document.getElementById('next-page').addEventListener('click', function() {
        if (currentPage >= pdfDoc.numPages) return;
        currentPage++;
        queueRenderPage(currentPage);
        window.scrollTo(0, 0);
      });
      
      // Zoom
      document.getElementById('zoom-select').addEventListener('change', function() {
        scale = parseFloat(this.value);
        currentPage = 1;
        renderPage(currentPage);
      });
      
      // Keyboard navigation
      document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          document.getElementById('prev-page').click();
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          document.getElementById('next-page').click();
        }
      });
    </script>
  </body>
  </html>
  `;
}

function renderTextViewer(filename, originalName, content) {
  const isEditable = ['txt', 'csv', 'json', 'md', 'html', 'css', 'js'].includes(
    path.extname(filename).toLowerCase().slice(1)
  );
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Text Viewer: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
    <style>
      pre {
        background: #f8f8f8;
        padding: 1em;
        border-radius: 0.25rem;
        overflow-x: auto;
      }
      #content {
        min-height: calc(100vh - 180px);
      }
    </style>
  </head>
  <body class="bg-gray-100">
    <div class="min-h-screen flex flex-col">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 class="text-lg font-medium text-gray-900 truncate max-w-xs">
            <i class="fas fa-file-alt text-blue-500 mr-2"></i>
            ${originalName}
          </h1>
          <div class="flex space-x-3">
            <a href="/download/${filename}" class="text-blue-600 hover:text-blue-800 flex items-center">
              <i class="fas fa-download mr-1"></i> Download
            </a>
            ${isEditable ? `
            <a href="/edit/${filename}" class="text-yellow-600 hover:text-yellow-800 flex items-center">
              <i class="fas fa-edit mr-1"></i> Edit
            </a>
            ` : ''}
            <a href="/" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-xl"></i>
            </a>
          </div>
        </div>
      </header>

      <!-- Content -->
      <main class="flex-grow">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <div class="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
              <div class="text-sm text-gray-500">
                ${formatBytes(Buffer.byteLength(content, 'utf8'))} • ${content.split('\n').length} lines
              </div>
              <div class="flex space-x-2">
                <button id="copy-btn" class="text-sm text-blue-600 hover:text-blue-800 flex items-center">
                  <i class="fas fa-copy mr-1"></i> Copy
                </button>
                <button id="wrap-btn" class="text-sm text-blue-600 hover:text-blue-800 flex items-center">
                  <i class="fas fa-text-width mr-1"></i> Toggle Wrap
                </button>
              </div>
            </div>
            <div class="p-4">
              <pre id="content" class="${isEditable ? 'hidden' : ''}"><code id="code-content">${escapeHtml(content)}</code></pre>
              ${isEditable ? `
              <form action="/save/${filename}" method="POST" class="${!isEditable ? 'hidden' : ''}">
                <textarea 
                  id="editable-content" 
                  name="content" 
                  class="w-full h-96 p-3 font-mono text-sm border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  spellcheck="false"
                >${escapeHtml(content)}</textarea>
                <div class="mt-3 flex justify-end space-x-3">
                  <a href="/preview/${filename}" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded">
                    Cancel
                  </a>
                  <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
                    Save Changes
                  </button>
                </div>
              </form>
              ` : ''}
            </div>
          </div>
        </div>
      </main>
    </div>

    <script>
      // Apply syntax highlighting
      document.addEventListener('DOMContentLoaded', () => {
        const codeElement = document.getElementById('code-content');
        if (codeElement) {
          const lang = getLanguage('${originalName}');
          if (lang) {
            codeElement.className = lang;
            hljs.highlightElement(codeElement);
          }
        }
        
        // Copy button
        document.getElementById('copy-btn').addEventListener('click', () => {
          const content = document.getElementById('${isEditable ? 'editable-content' : 'code-content'}').textContent;
          navigator.clipboard.writeText(content).then(() => {
            const btn = document.getElementById('copy-btn');
            btn.innerHTML = '<i class="fas fa-check mr-1"></i> Copied!';
            setTimeout(() => {
              btn.innerHTML = '<i class="fas fa-copy mr-1"></i> Copy';
            }, 2000);
          });
        });
        
        // Toggle word wrap
        document.getElementById('wrap-btn').addEventListener('click', () => {
          const pre = document.getElementById('content');
          pre.style.whiteSpace = pre.style.whiteSpace === 'pre-wrap' ? 'pre' : 'pre-wrap';
        });
      });
      
      function getLanguage(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const map = {
          js: 'javascript',
          html: 'html',
          css: 'css',
          json: 'json',
          md: 'markdown',
          txt: 'plaintext',
          csv: 'plaintext'
        };
        return map[ext] || null;
      }
      
      function escapeHtml(unsafe) {
        return unsafe
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }
    </script>
  </body>
  </html>
  `;
}

function renderFileEditor(filename, originalName, content) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Editing: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.15.2/ace.js"></script>
    <style>
      #editor { 
        height: calc(100vh - 180px);
        font-size: 14px;
      }
    </style>
  </head>
  <body class="bg-gray-100">
    <div class="min-h-screen flex flex-col">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 class="text-lg font-medium text-gray-900 truncate max-w-xs">
            <i class="fas fa-edit text-yellow-500 mr-2"></i>
            Editing: ${originalName}
          </h1>
          <div class="flex space-x-3">
            <a href="/preview/${filename}" class="text-blue-600 hover:text-blue-800 flex items-center">
              <i class="fas fa-eye mr-1"></i> Preview
            </a>
            <a href="/download/${filename}" class="text-green-600 hover:text-green-800 flex items-center">
              <i class="fas fa-download mr-1"></i> Download
            </a>
            <a href="/" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-xl"></i>
            </a>
          </div>
        </div>
      </header>

      <!-- Editor -->
      <main class="flex-grow">
        <div class="max-w-7xl mx-auto">
          <form action="/save/${filename}" method="POST" class="bg-white rounded-lg shadow-md overflow-hidden">
            <div id="editor">${escapeHtml(content)}</div>
            <textarea id="content" name="content" class="hidden"></textarea>
            <div class="bg-gray-50 px-4 py-3 border-t flex justify-between items-center">
              <div class="text-sm text-gray-500">
                ${path.extname(filename).toUpperCase().slice(1)} file • ${content.split('\n').length} lines
              </div>
              <div class="flex space-x-3">
                <a href="/preview/${filename}" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded">
                  Cancel
                </a>
                <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
                  Save Changes
                </button>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>

    <script>
      // Initialize ACE editor
      const editor = ace.edit("editor");
      editor.setTheme("ace/theme/chrome");
      editor.session.setMode(getMode('${originalName}'));
      editor.session.setUseWrapMode(true);
      editor.setOptions({
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true,
        showPrintMargin: false
      });
      
      // Update form textarea before submit
      document.querySelector('form').addEventListener('submit', () => {
        document.getElementById('content').value = editor.getValue();
      });
      
      // Handle keyboard shortcuts
      editor.commands.addCommand({
        name: 'save',
        bindKey: { win: 'Ctrl-S', mac: 'Command-S' },
        exec: function() {
          document.querySelector('form').submit();
        }
      });
      
      function getMode(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const map = {
          js: 'ace/mode/javascript',
          html: 'ace/mode/html',
          css: 'ace/mode/css',
          json: 'ace/mode/json',
          md: 'ace/mode/markdown',
          txt: 'ace/mode/text',
          csv: 'ace/mode/text'
        };
        return map[ext] || 'ace/mode/text';
      }
      
      function escapeHtml(unsafe) {
        return unsafe
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }
    </script>
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
    <title>File Preview: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="min-h-screen flex flex-col">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 class="text-lg font-medium text-gray-900 truncate max-w-xs">
            <i class="${getFileIcon(getFileType(filename))} ${getFileColor(getFileType(filename))} mr-2"></i>
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
      </header>

      <!-- Preview Content -->
      <main class="flex-grow flex items-center justify-center">
        <div class="bg-white rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <i class="${getFileIcon(getFileType(filename))} ${getFileColor(getFileType(filename))} text-6xl mb-4"></i>
          <h2 class="text-xl font-medium text-gray-900 mb-2">${originalName}</h2>
          <p class="text-gray-600 mb-4">${formatBytes(size)} • ${path.extname(filename).toUpperCase().slice(1) || 'FILE'} file</p>
          <p class="text-gray-500">Preview not available for this file type</p>
          <div class="mt-6">
            <a href="/download/${filename}" class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700">
              <i class="fas fa-download mr-2"></i> Download File
            </a>
          </div>
        </div>
      </main>
    </div>
  </body>
  </html>
  `;
}

function renderActivityHistory(history) {
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
    <div class="min-h-screen">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">
            <i class="fas fa-history text-purple-500 mr-2"></i>
            Activity History
          </h1>
          <a href="/" class="text-gray-600 hover:text-gray-900">
            <i class="fas fa-arrow-left mr-1"></i> Back to Files
          </a>
        </div>
      </header>

      <!-- Main Content -->
      <main class="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <div class="bg-white shadow rounded-lg overflow-hidden">
          <!-- Filters -->
          <div class="bg-gray-50 px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div class="mb-2 sm:mb-0">
              <label class="mr-2 text-sm font-medium text-gray-700">Filter:</label>
              <div class="inline-flex rounded-md shadow-sm">
                <a href="/history" class="px-3 py-1 text-sm rounded-l-md border ${!history.some(h => h.action) ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">
                  All
                </a>
                <a href="/history?action=upload" class="px-3 py-1 text-sm border-t border-b ${history.some(h => h.action === 'upload') ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">
                  Uploads
                </a>
                <a href="/history?action=download" class="px-3 py-1 text-sm border-t border-b ${history.some(h => h.action === 'download') ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">
                  Downloads
                </a>
                <a href="/history?action=edit" class="px-3 py-1 text-sm border-t border-b ${history.some(h => h.action === 'edit') ? 'bg-yellow-50 border-yellow-500 text-yellow-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">
                  Edits
                </a>
                <a href="/history?action=delete" class="px-3 py-1 text-sm rounded-r-md border ${history.some(h => h.action === 'delete') ? 'bg-red-50 border-red-500 text-red-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">
                  Deletes
                </a>
              </div>
            </div>
            <div class="text-sm text-gray-500">
              Showing ${history.length} most recent entries
            </div>
          </div>
          
          <!-- History Table -->
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File
                  </th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    IP Address
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                ${history.length > 0 ? history.map(entry => `
                <tr>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      entry.action === 'upload' ? 'bg-green-100 text-green-800' : 
                      entry.action === 'download' ? 'bg-blue-100 text-blue-800' :
                      entry.action === 'edit' ? 'bg-yellow-100 text-yellow-800' :
                      entry.action === 'delete' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }">
                      <i class="fas ${
                        entry.action === 'upload' ? 'fa-upload' : 
                        entry.action === 'download' ? 'fa-download' :
                        entry.action === 'edit' ? 'fa-edit' :
                        entry.action === 'delete' ? 'fa-trash' :
                        'fa-question'
                      } mr-1"></i>
                      ${entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 truncate max-w-xs">
                    ${entry.filename}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${entry.ip}
                  </td>
                </tr>
                `).join('') : `
                <tr>
                  <td colspan="4" class="px-6 py-12 text-center">
                    <i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i>
                    <p class="text-gray-500">No activity recorded yet</p>
                  </td>
                </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  </body>
  </html>
  `;
}

function renderError(message, isServerError) {
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
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white rounded-lg shadow-xl overflow-hidden max-w-md w-full">
        <div class="bg-red-600 p-4">
          <h1 class="text-white text-xl font-bold flex items-center">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            ${isServerError ? 'Server Error' : 'Error'}
          </h1>
        </div>
        <div class="p-6">
          <div class="flex">
            <div class="flex-shrink-0">
              <i class="fas fa-exclamation-circle text-red-500 text-3xl"></i>
            </div>
            <div class="ml-3">
              <h3 class="text-lg font-medium text-gray-900">${isServerError ? 'Something went wrong' : 'Operation failed'}</h3>
              <div class="mt-2 text-gray-600">
                <p>${message}</p>
                ${isServerError ? `
                <p class="mt-2 text-sm">The server encountered an error while processing your request.</p>
                ` : ''}
              </div>
            </div>
          </div>
          <div class="mt-6">
            <a href="/" class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700">
              <i class="fas fa-home mr-2"></i> Return to Dashboard
            </a>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

// ======================
// Server Startup
// ======================
app.listen(PORT, () => {
  console.log(`
  ⚡️ Advanced File Server v3.0
  =============================
  🚀 Server running at: http://localhost:${PORT}
  ⏰ Auto-ping enabled (every 30 seconds)
  📁 File storage: ${path.join(__dirname, uploadDir)}
  🔒 Security: Enabled
  💾 Max file size: ${formatBytes(maxFileSize)}
  📦 Max files per upload: ${maxFiles}
  `);
  
  // Initial ping
  selfPing();
});
