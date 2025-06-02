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
const maxFileSize = 200 * 1024 * 1024; // Increased to 200MB
const maxFiles = 20; // Increased to 20 files per upload
const allowedFileTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|csv|json|md|js|html|css|zip|tar|gz|rar|mp3|mp4|mov|avi|webm/; // More comprehensive list
const retentionDays = 30; // Files older than this will be marked for potential cleanup

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
    // Generate a unique ID for the file to store in metadata
    const fileId = crypto.randomBytes(16).toString('hex');
    const uniqueSuffix = Date.now();
    // Sanitize the original filename to prevent path traversal and other issues
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Store metadata in the filename itself for simplicity, or in a separate database
    cb(null, `${uniqueSuffix}-${fileId}-${sanitizedName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: maxFileSize, files: maxFiles },
  fileFilter: (req, file, cb) => {
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedFileTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}. Allowed types: ${allowedFileTypes.source}`));
    }
  }
});

// In-memory store for file metadata and history (consider a persistent store like SQLite for production)
let fileMetadata = {}; // { fileId: { name, size, type, uploaded, path, originalName, downloads, lastAccessed } }
let fileHistory = []; // { action, filename, timestamp, ip, userId (if authentication is added) }
let activeConnections = 0;

// ======================
// Helper Functions
// ======================
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  const typeMap = {
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
    pdf: 'pdf',
    doc: 'document', docx: 'document', xls: 'spreadsheet', xlsx: 'spreadsheet', ppt: 'presentation', pptx: 'presentation',
    txt: 'text', csv: 'text', json: 'text', md: 'text', xml: 'text', log: 'text',
    js: 'code', html: 'code', css: 'code', php: 'code', py: 'code', c: 'code', cpp: 'code', java: 'code', sh: 'code',
    zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive',
    mp3: 'audio', wav: 'audio', ogg: 'audio',
    mp4: 'video', mov: 'video', avi: 'video', webm: 'video', mkv: 'video'
  };
  return typeMap[ext] || 'other';
}

function getFileIcon(fileType) {
  const iconMap = {
    image: 'fas fa-file-image',
    pdf: 'fas fa-file-pdf',
    document: 'fas fa-file-word',
    spreadsheet: 'fas fa-file-excel',
    presentation: 'fas fa-file-powerpoint',
    text: 'fas fa-file-alt',
    code: 'fas fa-file-code',
    archive: 'fas fa-file-archive',
    audio: 'fas fa-file-audio',
    video: 'fas fa-file-video',
    other: 'fas fa-file'
  };
  return iconMap[fileType] || 'fas fa-file';
}

function logActivity(action, filename, req, fileId = 'N/A') {
  fileHistory.unshift({
    action,
    filename,
    fileId,
    timestamp: new Date().toISOString(),
    ip: req.ip || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    // userId: req.user ? req.user.id : 'guest' // Uncomment if authentication is implemented
  });

  // Keep history to last 1000 entries (or more, depending on needs)
  if (fileHistory.length > 1000) {
    fileHistory.pop();
  }
}

// Function to update file metadata (e.g., download count, last accessed)
function updateFileMetadata(fileId, updates) {
  if (fileMetadata[fileId]) {
    fileMetadata[fileId] = { ...fileMetadata[fileId], ...updates };
  }
}

// Function to get metadata from filename
function parseFilename(filename) {
  const parts = filename.split('-');
  if (parts.length < 3) return null; // Not a file managed by this system format

  const uploadedTimestamp = parseInt(parts[0]);
  const fileId = parts[1];
  const originalName = parts.slice(2).join('-');

  if (isNaN(uploadedTimestamp) || !fileId || !originalName) return null;

  return { uploadedTimestamp, fileId, originalName };
}

// Schedule a cleanup task (e.g., daily) - DANGER: Implement carefully in production
// This is a basic example, a more robust solution would involve user confirmation or strict policies
// setInterval(() => {
//     console.log('Running scheduled cleanup...');
//     const cutoffDate = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
//     fs.readdir(uploadDir, (err, files) => {
//         if (err) {
//             console.error('Cleanup directory read error:', err);
//             return;
//         }
//         files.forEach(file => {
//             const filePath = path.join(uploadDir, file);
//             try {
//                 const stats = fs.statSync(filePath);
//                 const { uploadedTimestamp } = parseFilename(file);
//                 if (uploadedTimestamp && uploadedTimestamp < cutoffDate) {
//                     console.log(`Deleting old file: ${file}`);
//                     fs.unlinkSync(filePath);
//                     delete fileMetadata[parseFilename(file).fileId]; // Remove from metadata
//                     logActivity('cleanup', parseFilename(file).originalName, { ip: 'system' });
//                 }
//             } catch (e) {
//                 console.error(`Cleanup file processing error for ${file}:`, e);
//             }
//         });
//     });
// }, 24 * 60 * 60 * 1000); // Run once every 24 hours (86400000 ms)

// ======================
// Middleware
// ======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Serve static files from the 'public' directory
app.use(express.static('public'));

// Security middleware - more robust headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self'; script-src 'self' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; style-src 'self' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com;"); // Example CSP, adjust as needed
  activeConnections++;
  res.on('finish', () => {
    activeConnections--;
  });
  next();
});

// Basic authentication middleware (example - use proper auth in production)
// This is a very simple example and should NOT be used for real authentication.
// For production, integrate with OAuth, JWT, session management, etc.
const authenticate = (req, res, next) => {
  // if (req.headers.authorization === 'Bearer YOUR_SECRET_TOKEN') {
  //   req.user = { id: 'admin', username: 'admin' }; // Dummy user
  //   next();
  // } else {
  //   res.status(401).send(renderError('Unauthorized: Please provide a valid token.'));
  // }
  next(); // For now, allowing all access
};
app.use(authenticate); // Apply authentication to all routes (adjust as needed)

// ======================
// Routes
// ======================
app.get('/ping', (req, res) => res.send('pong'));

app.get('/', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error('Directory read error:', err);
      return res.status(500).send(renderError('Server error: Could not list files.'));
    }

    const fileList = files.map(file => {
      try {
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath);
        const parsed = parseFilename(file);

        if (!parsed) {
          console.warn(`Skipping malformed filename: ${file}`);
          return null;
        }

        const { uploadedTimestamp, fileId, originalName } = parsed;

        // Populate fileMetadata if not already present
        if (!fileMetadata[fileId]) {
          fileMetadata[fileId] = {
            id: fileId,
            name: originalName,
            size: stats.size,
            uploaded: new Date(uploadedTimestamp).toISOString(),
            type: getFileType(file),
            path: filePath,
            originalName: originalName,
            downloads: 0,
            lastAccessed: null,
            lastModified: new Date(stats.mtime).toISOString()
          };
        } else {
          // Update stats if already exists (e.g., after an edit)
          fileMetadata[fileId].size = stats.size;
          fileMetadata[fileId].lastModified = new Date(stats.mtime).toISOString();
        }

        const fileEntry = fileMetadata[fileId];

        return {
          id: file, // Full filename for operations
          fileId: fileId, // Unique ID for metadata lookup
          name: originalName,
          size: formatBytes(fileEntry.size),
          uploaded: new Date(fileEntry.uploaded).toLocaleString(),
          lastModified: new Date(fileEntry.lastModified).toLocaleString(),
          type: fileEntry.type,
          icon: getFileIcon(fileEntry.type),
          downloadUrl: `/download/${file}`,
          previewUrl: `/preview/${file}`,
          editUrl: fileEntry.type === 'text' || fileEntry.type === 'code' ? `/edit/${file}` : null,
          downloads: fileEntry.downloads,
          lastAccessed: fileEntry.lastAccessed ? new Date(fileEntry.lastAccessed).toLocaleString() : 'Never'
        };
      } catch (e) {
        console.error(`File processing error for ${file}:`, e);
        return null;
      }
    }).filter(file => file !== null).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded)); // Sort by most recent upload

    res.send(renderDashboard(fileList));
  });
});

app.post('/upload', upload.array('files', maxFiles), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send(renderError('No files uploaded. Please select one or more files.'));
  }

  req.files.forEach(file => {
    const parsed = parseFilename(file.filename);
    if (parsed) {
      const { fileId, originalName, uploadedTimestamp } = parsed;
      fileMetadata[fileId] = {
        id: fileId,
        name: originalName,
        size: file.size,
        uploaded: new Date(uploadedTimestamp).toISOString(),
        type: getFileType(file.filename),
        path: file.path,
        originalName: originalName,
        downloads: 0,
        lastAccessed: null,
        lastModified: new Date().toISOString()
      };
      logActivity('upload', originalName, req, fileId);
    }
  });

  res.redirect('/');
});

app.get('/preview/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  const parsed = parseFilename(req.params.filename);

  if (!parsed || !fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  const { fileId, originalName } = parsed;
  updateFileMetadata(fileId, { lastAccessed: new Date().toISOString() });
  logActivity('preview', originalName, req, fileId);

  try {
    const fileType = getFileType(req.params.filename);

    if (fileType === 'image') {
      return res.send(renderImagePreview(req.params.filename, originalName));
    } else if (fileType === 'pdf') {
      return res.send(renderPDFPreview(req.params.filename, originalName));
    } else if (fileType === 'text' || fileType === 'code') {
      const content = fs.readFileSync(filePath, 'utf-8');
      return res.send(renderTextViewer(req.params.filename, originalName, content));
    } else if (fileType === 'audio') {
      return res.send(renderAudioPlayer(req.params.filename, originalName));
    } else if (fileType === 'video') {
      return res.send(renderVideoPlayer(req.params.filename, originalName));
    } else {
      const stats = fs.statSync(filePath);
      return res.send(renderDefaultPreview(req.params.filename, originalName, stats.size, fileType));
    }
  } catch (e) {
    console.error('Preview error:', e);
    res.status(500).send(renderError(`Error generating preview for ${originalName}.`));
  }
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  const parsed = parseFilename(req.params.filename);

  if (!parsed || !fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  const { fileId, originalName } = parsed;

  updateFileMetadata(fileId, { downloads: (fileMetadata[fileId].downloads || 0) + 1, lastAccessed: new Date().toISOString() });
  logActivity('download', originalName, req, fileId);

  res.download(filePath, originalName, (err) => {
    if (err) {
      console.error(`Download error for ${originalName}:`, err);
      // Check if headers have already been sent before sending a new response
      if (!res.headersSent) {
        res.status(500).send(renderError(`Could not download file ${originalName}.`));
      }
    }
  });
});

app.get('/edit/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  const parsed = parseFilename(req.params.filename);

  if (!parsed || !fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  const { fileId, originalName } = parsed;
  const fileType = getFileType(req.params.filename);

  if (fileType !== 'text' && fileType !== 'code') {
    return res.status(400).send(renderError(`Editing is only supported for text and code files. This is a ${fileType} file.`));
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    updateFileMetadata(fileId, { lastAccessed: new Date().toISOString() });
    res.send(renderFileEditor(req.params.filename, originalName, content));
  } catch (e) {
    console.error('Error reading file for edit:', e);
    res.status(500).send(renderError(`Error reading file ${originalName} for editing.`));
  }
});

app.post('/save/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  const parsed = parseFilename(req.params.filename);

  if (!parsed || !fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  const { fileId, originalName } = parsed;
  const fileType = getFileType(req.params.filename);

  if (fileType !== 'text' && fileType !== 'code') {
    return res.status(400).send(renderError(`Saving is only supported for text and code files. This is a ${fileType} file.`));
  }

  try {
    fs.writeFileSync(filePath, req.body.content);
    const stats = fs.statSync(filePath); // Get updated file size and modification time
    updateFileMetadata(fileId, { size: stats.size, lastModified: new Date().toISOString(), lastAccessed: new Date().toISOString() });
    logActivity('edit', originalName, req, fileId);
    res.redirect('/');
  } catch (e) {
    console.error('Error saving file:', e);
    res.status(500).send(renderError(`Error saving changes to ${originalName}.`));
  }
});

app.post('/delete/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  const parsed = parseFilename(req.params.filename);

  if (!parsed || !fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  const { fileId, originalName } = parsed;

  try {
    fs.unlinkSync(filePath);
    delete fileMetadata[fileId]; // Remove from in-memory metadata
    logActivity('delete', originalName, req, fileId);
    res.redirect('/');
  } catch (e) {
    console.error('Error deleting file:', e);
    res.status(500).send(renderError(`Error deleting file ${originalName}.`));
  }
});

app.post('/delete-multiple', (req, res) => {
  const filesToDelete = Array.isArray(req.body.files) ? req.body.files : [];
  let deletedCount = 0;
  let errorCount = 0;

  filesToDelete.forEach(filename => {
    const filePath = path.join(uploadDir, filename);
    const parsed = parseFilename(filename);

    if (parsed && fs.existsSync(filePath)) {
      const { fileId, originalName } = parsed;
      try {
        fs.unlinkSync(filePath);
        delete fileMetadata[fileId];
        logActivity('delete', originalName, req, fileId);
        deletedCount++;
      } catch (e) {
        console.error(`Error deleting file ${filename}:`, e);
        errorCount++;
      }
    } else {
      console.warn(`Attempted to delete non-existent or malformed file: ${filename}`);
      errorCount++;
    }
  });

  if (errorCount > 0) {
    res.status(500).send(renderError(`Successfully deleted ${deletedCount} files, but encountered errors with ${errorCount} files.`));
  } else {
    res.redirect('/');
  }
});

// Route for file sharing (generates a temporary, shareable link)
// This is a basic example; for production, implement token-based access, expiry, etc.
app.get('/share/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  const parsed = parseFilename(req.params.filename);

  if (!parsed || !fs.existsSync(filePath)) {
    return res.status(404).send(renderError('File not found for sharing.'));
  }

  const { fileId, originalName } = parsed;
  // In a real application, you'd generate a unique, short-lived token here
  // For simplicity, we'll just redirect to download, implying public access
  // For true sharing, you'd likely have a dedicated route like /s/:token
  logActivity('share', originalName, req, fileId);
  res.send(renderShareLink(req.params.filename, originalName));
});

// Admin Panel (requires robust authentication in production)
app.get('/admin', authenticate, (req, res) => {
  // Example data for admin panel
  const systemInfo = {
    totalFiles: Object.keys(fileMetadata).length,
    totalStorageUsed: formatBytes(Object.values(fileMetadata).reduce((sum, f) => sum + f.size, 0)),
    activeConnections: activeConnections,
    maxFileSize: formatBytes(maxFileSize),
    maxFilesPerUpload: maxFiles,
    retentionPolicy: `${retentionDays} days`
  };
  res.send(renderAdminPanel(systemInfo, fileMetadata, fileHistory));
});

// Route to get file metadata (for API use or advanced UI)
app.get('/api/file-metadata/:filename', (req, res) => {
  const parsed = parseFilename(req.params.filename);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid filename format' });
  }
  const fileId = parsed.fileId;
  const metadata = fileMetadata[fileId];
  if (metadata) {
    res.json(metadata);
  } else {
    res.status(404).json({ error: 'File metadata not found' });
  }
});

app.get('/history', (req, res) => {
  res.send(renderHistory(fileHistory));
});

// ======================
// Rendering Functions (HTML Templates)
// Tailwind CSS is used for styling. Font Awesome for icons.
// ======================

function renderDashboard(files) {
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
      /* Custom scrollbar for text viewer */
      pre::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      pre::-webkit-scrollbar-thumb {
        background-color: #cbd5e0; /* gray-400 */
        border-radius: 4px;
      }
      pre::-webkit-scrollbar-track {
        background-color: #f7fafc; /* gray-50 */
      }
    </style>
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

          if (confirm('Are you sure you want to delete ' + selectedFiles.length + ' selected files? This action cannot be undone.')) {
            fetch('/delete-multiple', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ files: selectedFiles })
            }).then(response => {
              if (response.ok) {
                window.location.reload();
              } else {
                response.text().then(text => alert('Failed to delete files: ' + text));
              }
            }).catch(error => alert('Network error: ' + error.message));
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

        // Drag and Drop for Upload Area
        const dropArea = document.getElementById('drop-area');
        const fileInput = document.getElementById('file-input');

        dropArea.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropArea.classList.add('border-blue-500', 'bg-blue-50');
        });

        dropArea.addEventListener('dragleave', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropArea.classList.remove('border-blue-500', 'bg-blue-50');
        });

        dropArea.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropArea.classList.remove('border-blue-500', 'bg-blue-50');

          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            // Optionally, submit the form automatically or indicate files are ready
            // document.getElementById('upload-form').submit();
            alert('Files ready for upload. Click "Upload Files" to proceed.');
          }
        });
      });
    </script>
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-4xl font-extrabold text-center mb-8 text-gray-800">🚀 Advanced File Server</h1>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div class="md:col-span-1 bg-white rounded-xl shadow-lg p-6">
          <h2 class="text-2xl font-semibold mb-6 text-gray-700">Upload Files</h2>
          <form id="upload-form" action="/upload" method="POST" enctype="multipart/form-data" class="flex flex-col space-y-4">
            <div id="drop-area" class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer transition-all duration-200 hover:border-blue-500 hover:bg-blue-50"
                 onclick="document.getElementById('file-input').click()">
              <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-3"></i>
              <p class="text-gray-600 font-medium">Drag & Drop files here, or Click to Browse</p>
              <p class="text-sm text-gray-500 mt-2">Max ${maxFiles} files, ${formatBytes(maxFileSize)} each</p>
              <input type="file" id="file-input" name="files" multiple class="hidden" accept="${allowedFileTypes.source.replace(/\|/g, ',.')}">
            </div>
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 flex items-center justify-center">
              <i class="fas fa-upload mr-3"></i> Upload Files
            </button>
          </form>

          <div class="mt-10 border-t pt-8 border-gray-200">
            <h2 class="text-2xl font-semibold mb-5 text-gray-700">Server Status</h2>
            <div class="space-y-4">
              <div class="flex items-center p-3 bg-green-50 rounded-lg shadow-sm">
                <div class="h-4 w-4 bg-green-500 rounded-full mr-3 animate-pulse"></div>
                <span class="font-medium text-green-800">Online and Operational</span>
              </div>
              <div class="flex items-center text-gray-700">
                <i class="fas fa-server text-blue-500 text-2xl w-8"></i>
                <div>
                  <p class="font-semibold">System Metrics</p>
                  <p class="text-sm text-gray-600">Port: ${PORT} | Files: ${Object.keys(fileMetadata).length} | Connections: <span id="active-connections">${activeConnections}</span></p>
                </div>
              </div>
              <div class="flex items-center text-gray-700">
                <i class="fas fa-hdd text-purple-500 text-2xl w-8"></i>
                <div>
                  <p class="font-semibold">Storage Usage</p>
                  <p class="text-sm text-gray-600">${formatBytes(Object.values(fileMetadata).reduce((sum, f) => sum + f.size, 0))} / ${formatBytes(maxFileSize * maxFiles)} (estimated max)</p>
                </div>
              </div>
              <div class="flex items-center text-gray-700">
                <i class="fas fa-history text-orange-500 text-2xl w-8"></i>
                <div>
                  <p class="font-semibold">Activity Log</p>
                  <p class="text-sm text-gray-600">${fileHistory.length} actions logged</p>
                </div>
              </div>
              <a href="/history" class="block mt-6 text-blue-600 hover:text-blue-800 flex items-center text-md font-medium transition-colors duration-200">
                <i class="fas fa-list-alt mr-2"></i> View Full Activity Log
              </a>
              <a href="/admin" class="block mt-4 text-purple-600 hover:text-purple-800 flex items-center text-md font-medium transition-colors duration-200">
                <i class="fas fa-user-cog mr-2"></i> Admin Panel
              </a>
            </div>
          </div>
        </div>

        <div class="md:col-span-3 bg-white rounded-xl shadow-lg p-6">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
            <h2 class="text-2xl font-semibold mb-4 md:mb-0 text-gray-700">File Manager</h2>
            <div class="flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-3 w-full md:w-auto">
              <div class="relative w-full md:w-auto">
                <input
                  type="text"
                  id="search-input"
                  placeholder="Search files by name..."
                  class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                >
                <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
              </div>
              <button
                id="delete-selected"
                class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center justify-center transition-colors duration-200"
              >
                <i class="fas fa-trash mr-2"></i> Delete Selected
              </button>
            </div>
          </div>

          <div class="overflow-x-auto rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left w-10">
                    <input type="checkbox" id="select-all" class="rounded text-blue-600 focus:ring-blue-500">
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Downloads</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody id="file-list" class="bg-white divide-y divide-gray-200">
                ${files.length > 0 ? files.map(file => `
                <tr class="hover:bg-gray-50 transition-colors duration-100">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <input type="checkbox" class="file-checkbox rounded text-blue-600 focus:ring-blue-500" value="${file.id}">
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex items-center">
                      <i class="${file.icon} text-blue-500 mr-3 text-lg"></i>
                      <span class="file-name text-gray-800 font-medium">${file.name}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                      ${file.type.charAt(0).toUpperCase() + file.type.slice(1)}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-gray-700">${file.size}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-gray-700" title="Last Modified: ${file.lastModified}">${file.uploaded}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-gray-700">${file.downloads}</td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex space-x-4">
                      <a href="${file.previewUrl}" class="text-blue-600 hover:text-blue-800 transition-colors duration-200" title="Preview">
                        <i class="fas fa-eye text-lg"></i>
                      </a>
                      <a href="${file.downloadUrl}" class="text-green-600 hover:text-green-800 transition-colors duration-200" title="Download">
                        <i class="fas fa-download text-lg"></i>
                      </a>
                      ${file.editUrl ? `
                      <a href="${file.editUrl}" class="text-yellow-600 hover:text-yellow-800 transition-colors duration-200" title="Edit">
                        <i class="fas fa-edit text-lg"></i>
                      </a>
                      ` : `
                      <span class="text-gray-400 cursor-not-allowed" title="Editing not available for this file type">
                        <i class="fas fa-edit text-lg"></i>
                      </span>
                      `}
                      <a href="/share/${file.id}" class="text-purple-600 hover:text-purple-800 transition-colors duration-200" title="Share">
                        <i class="fas fa-share-alt text-lg"></i>
                      </a>
                      <button onclick="if(confirm('Are you absolutely sure you want to delete \'${file.name}\'? This cannot be undone.')) window.location.href='/delete/${file.id}'"
                        class="text-red-600 hover:text-red-800 transition-colors duration-200" title="Delete">
                        <i class="fas fa-trash text-lg"></i>
                      </button>
                    </div>
                  </td>
                </tr>
                `).join('') : `
                <tr>
                  <td colspan="7" class="px-6 py-16 text-center text-gray-500">
                    <i class="fas fa-inbox text-5xl text-gray-300 mb-4"></i>
                    <p class="text-lg">No files uploaded yet. Start by uploading some files!</p>
                  </td>
                </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <script>
      // Update active connections dynamically (simple polling example)
      // In a real-time system, consider WebSockets
      // setInterval(async () => {
      //   const response = await fetch('/api/status'); // A new endpoint to provide server status
      //   const data = await response.json();
      //   document.getElementById('active-connections').textContent = data.activeConnections;
      // }, 5000); // Every 5 seconds
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
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-image text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-arrow-left mr-1"></i> Back
          </a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-lg p-6 flex justify-center items-center overflow-hidden" style="min-height: 70vh;">
        <img src="/download/${filename}" alt="${originalName}" class="max-w-full max-h-full object-contain border border-gray-200 rounded-lg">
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
    <title>PDF Preview: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-file-pdf text-red-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-arrow-left mr-1"></i> Back
          </a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-lg overflow-hidden" style="min-height: 80vh;">
        <iframe
          src="/download/${filename}"
          class="w-full h-full border-none"
          title="PDF Viewer for ${originalName}"
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
    <title>Text Viewer: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      pre {
        white-space: pre-wrap; /* Ensures long lines wrap */
        word-wrap: break-word; /* Breaks long words */
      }
      /* Custom scrollbar for text viewer */
      pre::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      pre::-webkit-scrollbar-thumb {
        background-color: #cbd5e0; /* gray-400 */
        border-radius: 4px;
      }
      pre::-webkit-scrollbar-track {
        background-color: #f7fafc; /* gray-50 */
      }
    </style>
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-file-alt text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/edit/${filename}" class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-edit mr-1"></i> Edit
          </a>
          <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-arrow-left mr-1"></i> Back
          </a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-lg overflow-hidden">
        <pre class="p-6 font-mono text-sm leading-relaxed text-gray-800 bg-gray-50 border border-gray-200 rounded-lg overflow-auto" style="max-height: 80vh;">${escapeHtml(content)}</pre>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderAudioPlayer(filename, originalName) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio Player: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-file-audio text-green-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-arrow-left mr-1"></i> Back
          </a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-lg p-8 flex flex-col items-center justify-center">
        <i class="fas fa-music text-6xl text-gray-400 mb-6"></i>
        <p class="text-xl font-medium text-gray-700 mb-4">${originalName}</p>
        <audio controls class="w-full max-w-lg">
          <source src="/download/${filename}" type="audio/${path.extname(filename).slice(1)}">
          Your browser does not support the audio element.
        </audio>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderVideoPlayer(filename, originalName) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Video Player: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-file-video text-purple-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-arrow-left mr-1"></i> Back
          </a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-lg p-6 flex flex-col items-center justify-center">
        <p class="text-xl font-medium text-gray-700 mb-4">${originalName}</p>
        <video controls class="w-full max-w-3xl border border-gray-200 rounded-lg">
          <source src="/download/${filename}" type="video/${path.extname(filename).slice(1)}">
          Your browser does not support the video element.
        </video>
      </div>
    </div>
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
    <title>Edit File: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      /* Custom scrollbar for textarea */
      textarea::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      textarea::-webkit-scrollbar-thumb {
        background-color: #cbd5e0; /* gray-400 */
        border-radius: 4px;
      }
      textarea::-webkit-scrollbar-track {
        background-color: #f7fafc; /* gray-50 */
      }
    </style>
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-edit text-yellow-500 mr-2"></i>
          Editing: ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/preview/${filename}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-eye mr-1"></i> Preview
          </a>
          <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-arrow-left mr-1"></i> Back to Dashboard
          </a>
        </div>
      </div>

      <form action="/save/${filename}" method="POST" class="bg-white rounded-xl shadow-lg p-6">
        <textarea
          name="content"
          rows="25"
          class="w-full p-4 font-mono text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 text-gray-800"
          spellcheck="false"
        >${escapeHtml(content)}</textarea>
        <div class="mt-6 flex justify-end space-x-3">
          <a href="/preview/${filename}" class="bg-gray-500 hover:bg-gray-600 text-white px-5 py-2 rounded-lg font-semibold transition-colors duration-200">
            Cancel
          </a>
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold transition-colors duration-200">
            <i class="fas fa-save mr-2"></i> Save Changes
          </button>
        </div>
      </form>
    </div>
  </body>
  </html>
  `;
}

function renderDefaultPreview(filename, originalName, size, fileType) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Info: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="${getFileIcon(fileType)} text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-3">
          <a href="/download/${filename}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-download mr-1"></i> Download
          </a>
          <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
            <i class="fas fa-arrow-left mr-1"></i> Back
          </a>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-lg p-8 text-center">
        <i class="${getFileIcon(fileType)} text-7xl text-gray-400 mb-6"></i>
        <h2 class="text-2xl font-medium text-gray-800 mb-3">${originalName}</h2>
        <p class="text-gray-600 mb-6">${formatBytes(size)} • ${path.extname(filename).toUpperCase().slice(1) || 'Unknown Type'}</p>
        <p class="text-gray-500 text-lg">
          Preview is not available for this file type. You can download it to view.
        </p>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderShareLink(filename, originalName) {
  const shareableLink = `${req.protocol}://${req.get('host')}/download/${filename}`; // Or a dedicated /s/:token route

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Share File: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-share-alt text-purple-500 mr-2"></i>
          Share: ${originalName}
        </h1>
        <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
          <i class="fas fa-arrow-left mr-1"></i> Back
        </a>
      </div>

      <div class="bg-white rounded-xl shadow-lg p-8 text-center">
        <p class="text-gray-700 text-lg mb-4">
          Share this link to allow others to download <strong>${originalName}</strong>:
        </p>
        <div class="flex items-center justify-center space-x-3 mb-6">
          <input type="text" id="shareLink" value="${shareableLink}" readonly
                 class="w-full max-w-xl p-3 border border-gray-300 rounded-lg bg-gray-50 font-mono text-blue-700">
          <button onclick="copyShareLink()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-lg font-semibold transition-colors duration-200">
            <i class="fas fa-copy mr-2"></i> Copy
          </button>
        </div>
        <p class="text-sm text-gray-500">
          Note: This link provides direct download access. For more secure sharing, consider implementing expiring links or password protection.
        </p>
      </div>
    </div>
    <script>
      function copyShareLink() {
        const shareLinkInput = document.getElementById('shareLink');
        shareLinkInput.select();
        document.execCommand('copy');
        alert('Share link copied to clipboard!');
      }
    </script>
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
  <body class="bg-gray-100 flex flex-col min-h-screen">
    <div class="container mx-auto px-4 py-8 flex-grow">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-history text-purple-500 mr-2"></i>
          Activity History
        </h1>
        <a href="/" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
          <i class="fas fa-arrow-left mr-1"></i> Back to Dashboard
        </a>
      </div>

      <div class="bg-white rounded-xl shadow-lg overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User Agent</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${history.length > 0 ? history.map(entry => `
            <tr class="hover:bg-gray-50 transition-colors duration-100">
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-3 py-1 inline-flex items-center text-xs font-semibold rounded-full ${
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
                    'fa-info-circle'
                  } mr-1"></i>
                  ${entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                </span>
              </td>
              <td class="px-6 py-4 text-gray-800">${escapeHtml(entry.filename)}</td>
              <td class="px-6 py-4 text-gray-700">${new Date(entry.timestamp).toLocaleString()}</td>
              <td class="px-6 py-4 text-gray-700">${escapeHtml(entry.ip)}</td>
              <td class="px-6 py-4 text-gray-700 text-sm">${escapeHtml(entry.userAgent)}</td>
            </tr>
            `).join('') : `
            <tr>
              <td colspan="5" class="px-6 py-12 text-center text-gray-500">
                <i class="fas fa-clipboard-list text-5xl text-gray-300 mb-4"></i>
                <p class="text-lg">No activity recorded yet.</p>
              </td>
            </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderAdminPanel(systemInfo, fileMetadata, fileHistory) {
    const files = Object.values(fileMetadata);
    const recentHistory = fileHistory.slice(0, 10); // Show top 10 recent activities
    const popularFiles = files.sort((a, b) => b.downloads - a.downloads).slice(0, 5);
    const fileTypes = files.reduce((acc, file) => {
        acc[file.type] = (acc[file.type] || 0) + 1;
        return acc;
    }, {});
    const fileTypeBreakdown = Object.entries(fileTypes).map(([type, count]) => `
        <li class="flex justify-between items-center text-gray-700">
            <span><i class="${getFileIcon(type)} mr-2 text-blue-500"></i> ${type.charAt(0).toUpperCase() + type.slice(1)}</span>
            <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">${count}</span>
        </li>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Panel</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-100 flex flex-col min-h-screen">
        <div class="container mx-auto px-4 py-8 flex-grow">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="fas fa-user-cog text-indigo-500 mr-2"></i>
                    Admin Panel
                </h1>
                <a href="/" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                    <i class="fas fa-arrow-left mr-1"></i> Back to Dashboard
                </a>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div class="bg-white rounded-xl shadow-lg p-6">
                    <h2 class="text-xl font-semibold mb-4 text-gray-700 flex items-center">
                        <i class="fas fa-info-circle mr-2 text-indigo-500"></i> System Overview
                    </h2>
                    <ul class="space-y-3 text-gray-700">
                        <li class="flex justify-between"><span>Total Files:</span> <span class="font-medium">${systemInfo.totalFiles}</span></li>
                        <li class="flex justify-between"><span>Total Storage Used:</span> <span class="font-medium">${systemInfo.totalStorageUsed}</span></li>
                        <li class="flex justify-between"><span>Active Connections:</span> <span class="font-medium">${systemInfo.activeConnections}</span></li>
                        <li class="flex justify-between"><span>Max File Size:</span> <span class="font-medium">${systemInfo.maxFileSize}</span></li>
                        <li class="flex justify-between"><span>Max Files per Upload:</span> <span class="font-medium">${systemInfo.maxFilesPerUpload}</span></li>
                        <li class="flex justify-between"><span>File Retention Policy:</span> <span class="font-medium">${systemInfo.retentionPolicy}</span></li>
                    </ul>
                </div>

                <div class="bg-white rounded-xl shadow-lg p-6">
                    <h2 class="text-xl font-semibold mb-4 text-gray-700 flex items-center">
                        <i class="fas fa-chart-pie mr-2 text-green-500"></i> File Type Breakdown
                    </h2>
                    <ul class="space-y-3">
                        ${fileTypeBreakdown.length > 0 ? fileTypeBreakdown : '<li class="text-gray-500">No files to categorize.</li>'}
                    </ul>
                </div>

                <div class="bg-white rounded-xl shadow-lg p-6">
                    <h2 class="text-xl font-semibold mb-4 text-gray-700 flex items-center">
                        <i class="fas fa-trophy mr-2 text-yellow-500"></i> Most Downloaded Files
                    </h2>
                    <ul class="space-y-3">
                        ${popularFiles.length > 0 ? popularFiles.map(file => `
                            <li class="flex justify-between items-center text-gray-700">
                                <span class="truncate">${escapeHtml(file.name)}</span>
                                <span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-semibold">${file.downloads} downloads</span>
                            </li>
                        `).join('') : '<li class="text-gray-500">No downloads recorded.</li>'}
                    </ul>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-lg p-6">
                <h2 class="text-xl font-semibold mb-4 text-gray-700 flex items-center">
                    <i class="fas fa-clock-rotate-left mr-2 text-blue-500"></i> Recent Activity (Last 10)
                </h2>
                <div class="overflow-x-auto rounded-lg border border-gray-200">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${recentHistory.length > 0 ? recentHistory.map(entry => `
                                <tr class="hover:bg-gray-50">
                                    <td class="px-6 py-4 whitespace-nowrap">
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
                                    <td class="px-6 py-4 text-gray-800 truncate" style="max-width: 200px;">${escapeHtml(entry.filename)}</td>
                                    <td class="px-6 py-4 text-gray-700">${new Date(entry.timestamp).toLocaleString()}</td>
                                    <td class="px-6 py-4 text-gray-700">${escapeHtml(entry.ip)}</td>
                                </tr>
                            `).join('') : `
                                <tr>
                                    <td colspan="4" class="px-6 py-12 text-center text-gray-500">No recent activity.</td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>
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
  <body class="bg-gray-100 flex items-center justify-center min-h-screen">
    <div class="container mx-auto px-4 py-8">
      <div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-8 rounded-lg shadow-md max-w-lg mx-auto" role="alert">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <i class="fas fa-exclamation-triangle text-red-500 text-3xl"></i>
          </div>
          <div class="ml-4">
            <h3 class="text-xl font-bold mb-2">Operation Failed!</h3>
            <p class="text-lg">${escapeHtml(message)}</p>
            <div class="mt-6">
              <a href="/" class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-200 hover:bg-red-300 transition-colors duration-200">
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

// Helper to escape HTML to prevent XSS in displayed content
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}


// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ⚡️ Advanced File Server
  ========================
  🚀 Server running on port ${PORT}
  🔗 Access at: http://localhost:${PORT}/
  📁 File storage: ${path.join(__dirname, uploadDir)}
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed.');
        // Optionally, save in-memory data to a persistent store here
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed.');
        // Optionally, save in-memory data to a persistent store here
        process.exit(0);
    });
});
