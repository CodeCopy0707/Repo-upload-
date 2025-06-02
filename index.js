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
const uploadDir = 'uploads'; // Directory to store uploaded files
const maxFileSize = 200 * 1024 * 1024; // 200MB (Increased for more flexibility)
const maxFiles = 20; // Maximum files per upload request (Increased)
const historyLimit = 1000; // Max entries in activity history

// Ensure the upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ======================
// Storage Configuration for Multer
// ======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // Store files in the 'uploads' directory
  },
  filename: (req, file, cb) => {
    // Generate a unique and safe filename: timestamp-randomSuffix-originalName
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    // Sanitize original filename to prevent directory traversal or invalid characters
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${uniqueSuffix}-${sanitizedName}`);
  }
});

// Multer upload middleware configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: maxFileSize, // Limit file size
    files: maxFiles // Limit number of files in a single upload
  },
  fileFilter: (req, file, cb) => {
    // Optional: Implement stricter file type filtering if needed
    // Example: Only allow images and PDFs
    // if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
    //   return cb(new Error('Only images and PDFs are allowed!'), false);
    // }
    cb(null, true);
  }
});

// Global state variables
let fileHistory = []; // Stores activity logs
let activeConnections = 0; // Tracks active HTTP connections for server status

// ======================
// Helper Functions (Utility and Formatting)
// ======================

/**
 * Formats bytes into a human-readable string (e.g., KB, MB, GB).
 * @param {number} bytes - The number of bytes.
 * @returns {string} Formatted size string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Determines the general type of a file based on its extension.
 * @param {string} filename - The name of the file.
 * @returns {string} A general file type (e.g., 'image', 'pdf', 'text', 'code', 'archive', 'audio', 'video', 'other').
 */
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  const typeMap = {
    // Images
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image', webp: 'image', tiff: 'image',
    // Documents
    pdf: 'pdf',
    doc: 'document', docx: 'document',
    xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet',
    ppt: 'presentation', pptx: 'presentation',
    // Text and Code
    txt: 'text', md: 'text', rtf: 'text',
    js: 'code', html: 'code', css: 'code', json: 'code', xml: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', sh: 'code',
    // Archives
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
    // Audio
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio',
    // Video
    mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video', flv: 'video',
    // Other
    exe: 'executable', dmg: 'executable', iso: 'disk_image',
  };
  return typeMap[ext] || 'other'; // Default to 'other' if not found
}

/**
 * Returns a Font Awesome icon class based on the file type.
 * @param {string} fileType - The general file type (from getFileType).
 * @returns {string} Font Awesome icon class.
 */
function getFileIcon(fileType) {
  const iconMap = {
    image: 'fa-file-image',
    pdf: 'fa-file-pdf',
    document: 'fa-file-word',
    spreadsheet: 'fa-file-excel',
    presentation: 'fa-file-powerpoint',
    text: 'fa-file-alt',
    code: 'fa-file-code',
    archive: 'fa-file-archive',
    audio: 'fa-file-audio',
    video: 'fa-file-video',
    executable: 'fa-file-invoice', // Or fa-cogs
    disk_image: 'fa-compact-disc',
    other: 'fa-file'
  };
  return iconMap[fileType] || 'fa-file';
}

/**
 * Logs an activity to the in-memory history.
 * @param {string} action - The action performed (e.g., 'upload', 'download', 'edit', 'delete').
 * @param {string} filename - The original name of the file involved.
 * @param {object} req - The Express request object to get IP address.
 */
function logActivity(action, filename, req) {
  fileHistory.unshift({ // Add to the beginning
    action: action,
    filename: filename,
    timestamp: new Date().toISOString(),
    ip: req.ip || 'unknown' // Log client IP address
  });

  // Trim history to limit
  if (fileHistory.length > historyLimit) {
    fileHistory.pop(); // Remove the oldest entry
  }
}

// ======================
// Middleware
// ======================
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (for form submissions)
app.use(express.json()); // Parse JSON bodies
app.use(express.static('public')); // Serve static files from the 'public' directory

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); // Prevent MIME-sniffing
  res.setHeader('X-Frame-Options', 'DENY'); // Prevent clickjacking
  res.setHeader('X-XSS-Protection', '1; mode=block'); // Enable XSS protection
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'); // HSTS
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade'); // Referrer policy
  activeConnections++; // Increment active connections counter
  res.on('finish', () => { // Decrement when response is sent
    activeConnections--;
  });
  next();
});

// Basic logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// ======================
// Routes
// ======================

// Health check endpoint
app.get('/ping', (req, res) => res.send('pong'));

// Root route - Dashboard view
app.get('/', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error('Directory read error:', err);
      // Render an error page in case of server issues reading directory
      return res.status(500).send(renderError('Server error: Could not read file directory.'));
    }

    const fileList = files.map(file => {
      try {
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath); // Get file statistics
        const parts = file.split('-'); // Split the unique filename (timestamp-suffix-original)
        const uploadedTimestamp = parseInt(parts[0]);
        // Reconstruct original name from parts, handling potential hyphens in original name
        const originalName = parts.slice(2).join('-');
        const fileType = getFileType(file);

        return {
          id: file, // Full unique filename
          name: originalName,
          size: formatBytes(stats.size),
          uploaded: new Date(uploadedTimestamp).toLocaleString(), // Format upload timestamp
          type: fileType,
          icon: getFileIcon(fileType),
          downloadUrl: `/download/${file}`,
          previewUrl: `/preview/${file}`,
          editUrl: (fileType === 'text' || fileType === 'code') ? `/edit/${file}` : null // Only editable for text/code
        };
      } catch (e) {
        console.error(`Error processing file ${file}:`, e);
        // If a file is corrupted or unreadable, exclude it from the list
        return null;
      }
    }).filter(file => file !== null); // Filter out any null entries from errors

    res.send(renderDashboard(fileList, activeConnections)); // Pass active connections to dashboard
  });
});

// File Upload Route
app.post('/upload', upload.array('files', maxFiles), (req, res) => {
  if (!req.files || req.files.length === 0) {
    // Handle no files uploaded case
    return res.status(400).send(renderError('No files were uploaded. Please select one or more files.'));
  }

  req.files.forEach(file => {
    // Log each successful upload
    logActivity('upload', file.originalname, req);
  });

  res.redirect('/'); // Redirect back to the dashboard after upload
});

// File Preview Route
app.get('/preview/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  // Validate filename to prevent path traversal
  if (!fs.existsSync(filePath) || !filePath.startsWith(path.resolve(uploadDir))) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  try {
    const fileType = getFileType(filename);
    const parts = filename.split('-');
    const originalName = parts.slice(2).join('-');
    const stats = fs.statSync(filePath);

    // Conditional rendering based on file type for optimal preview
    if (fileType === 'image') {
      return res.send(renderImagePreview(filename, originalName));
    } else if (fileType === 'pdf') {
      return res.send(renderPDFPreview(filename, originalName));
    } else if (fileType === 'text' || fileType === 'code') {
      const content = fs.readFileSync(filePath, 'utf-8');
      return res.send(renderTextViewer(filename, originalName, content));
    } else if (fileType === 'audio' || fileType === 'video') {
      // For media, use HTML5 audio/video tags which link directly to download URL
      return res.send(renderMediaPlayer(filename, originalName, fileType));
    } else {
      // For other file types, offer download and basic info
      return res.send(renderDefaultPreview(filename, originalName, stats.size));
    }
  } catch (e) {
    console.error('Preview error:', e);
    res.status(500).send(renderError('Error generating preview. The file might be corrupted or unreadable.'));
  }
});

// File Download Route
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);
  const parts = filename.split('-');
  const originalName = parts.slice(2).join('-');

  // Validate filename to prevent path traversal
  if (!fs.existsSync(filePath) || !filePath.startsWith(path.resolve(uploadDir))) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  try {
    logActivity('download', originalName, req); // Log download activity
    // Set Content-Disposition header to ensure proper filename for download
    res.download(filePath, originalName, (err) => {
      if (err) {
        console.error('Download error:', err);
        // Handle specific download errors, e.g., file not found (though checked above), permissions
        if (err.code === 'ENOENT') {
          return res.status(404).send(renderError('File not found during download.'));
        }
        res.status(500).send(renderError('Failed to download the file.'));
      }
    });
  } catch (e) {
    console.error('Download preparation error:', e);
    res.status(500).send(renderError('An unexpected error occurred during download preparation.'));
  }
});

// File Edit Route (GET for editor page)
app.get('/edit/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  // Validate filename and ensure it's a text/code file before attempting to edit
  const fileType = getFileType(filename);
  if (fileType !== 'text' && fileType !== 'code') {
    return res.status(400).send(renderError('Only text and code files can be edited directly.'));
  }

  if (!fs.existsSync(filePath) || !filePath.startsWith(path.resolve(uploadDir))) {
    return res.status(404).send(renderError('File not found or invalid filename.'));
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.send(renderFileEditor(filename, content));
  } catch (e) {
    console.error('Error reading file for editing:', e);
    res.status(500).send(renderError('Error reading file for editing. It might be too large or corrupted.'));
  }
});

// File Save Route (POST for saving edited content)
app.post('/save/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);
  const newContent = req.body.content;

  // Validate filename
  if (!fs.existsSync(filePath) || !filePath.startsWith(path.resolve(uploadDir))) {
    return res.status(404).send(renderError('File not found or invalid filename for saving.'));
  }

  // Basic validation of content
  if (typeof newContent !== 'string') {
    return res.status(400).send(renderError('Invalid content provided for saving.'));
  }

  try {
    fs.writeFileSync(filePath, newContent, 'utf-8');
    const parts = filename.split('-');
    const originalName = parts.slice(2).join('-');
    logActivity('edit', originalName, req); // Log edit activity
    res.redirect('/'); // Redirect back to dashboard
  } catch (e) {
    console.error('Error saving file:', e);
    res.status(500).send(renderError('Error saving file. Check file permissions or disk space.'));
  }
});

// File Delete Route (Single file)
app.post('/delete/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);

  // Validate filename
  if (!fs.existsSync(filePath) || !filePath.startsWith(path.resolve(uploadDir))) {
    return res.status(404).send(renderError('File not found or invalid filename for deletion.'));
  }

  try {
    fs.unlinkSync(filePath); // Delete the file
    const parts = filename.split('-');
    const originalName = parts.slice(2).join('-');
    logActivity('delete', originalName, req); // Log delete activity
    res.redirect('/'); // Redirect back to dashboard
  } catch (e) {
    console.error('Error deleting file:', e);
    res.status(500).send(renderError('Error deleting file. Check file permissions.'));
  }
});

// Multiple File Delete Route (Bulk deletion)
app.post('/delete-multiple', (req, res) => {
  // Ensure req.body.files is an array
  const filesToDelete = Array.isArray(req.body.files) ? req.body.files : [];

  if (filesToDelete.length === 0) {
    return res.status(400).send(renderError('No files selected for multiple deletion.'));
  }

  let deletedCount = 0;
  let errorMessages = [];

  filesToDelete.forEach(filename => {
    const filePath = path.join(uploadDir, filename);
    // Crucial security check: Ensure the file path is within the designated upload directory
    if (fs.existsSync(filePath) && filePath.startsWith(path.resolve(uploadDir))) {
      try {
        fs.unlinkSync(filePath);
        const parts = filename.split('-');
        const originalName = parts.slice(2).join('-');
        logActivity('delete', originalName, req);
        deletedCount++;
      } catch (e) {
        console.error(`Error deleting file ${filename}:`, e);
        errorMessages.push(`Failed to delete ${filename}: ${e.message}`);
      }
    } else {
      errorMessages.push(`Skipped invalid or non-existent file: ${filename}`);
    }
  });

  if (errorMessages.length > 0) {
    // Optionally redirect with a message or render an error page
    console.warn(`Bulk delete completed with errors: ${errorMessages.join(', ')}`);
    // For simplicity, we just redirect. A more robust solution might show a flash message.
  }
  res.redirect('/');
});

// Activity History Route
app.get('/history', (req, res) => {
  res.send(renderHistory(fileHistory));
});

// Error handling middleware (catch-all for unhandled errors)
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.stack);
  res.status(500).send(renderError('An unexpected server error occurred. Please try again later.'));
});

// Handle 404 Not Found
app.use((req, res) => {
  res.status(404).send(renderError(`The page you are looking for (${req.url}) does not exist.`));
});

// ======================
// Rendering Functions (HTML Templates)
// Using inline CSS (TailwindCSS CDN) and JS for simplicity.
// For a larger app, consider a templating engine (EJS, Pug) and separate static assets.
// ======================

function renderDashboard(files, connections) {
  // Determine if there are any text/code files for the 'edit' filter
  const hasEditableFiles = files.some(file => file.editUrl !== null);

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Advanced File Server</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
    <style>
      /* Custom scrollbar for better UX */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 10px;
      }
      ::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 10px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: #555;
      }
    </style>
    <script>
      document.addEventListener('DOMContentLoaded', () => {
        // Bulk delete functionality
        const deleteSelectedButton = document.getElementById('delete-selected');
        if (deleteSelectedButton) {
          deleteSelectedButton.addEventListener('click', () => {
            const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked'))
              .map(checkbox => checkbox.value);
            
            if (selectedFiles.length === 0) {
              alert('Please select files to delete.');
              return;
            }
            
            if (confirm(\`Are you sure you want to delete \${selectedFiles.length} selected files?\`)) {
              fetch('/delete-multiple', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ files: selectedFiles })
              }).then(response => {
                if (response.ok) {
                  window.location.reload(); // Reload on success
                } else {
                  alert('Failed to delete selected files. Please check server logs.');
                }
              }).catch(error => {
                console.error('Error during bulk delete:', error);
                alert('Network error or server unreachable during bulk delete.');
              });
            }
          });
        }
        
        // Select all checkbox
        const selectAllCheckbox = document.getElementById('select-all');
        if (selectAllCheckbox) {
          selectAllCheckbox.addEventListener('change', (e) => {
            document.querySelectorAll('.file-checkbox').forEach(checkbox => {
              checkbox.checked = e.target.checked;
            });
          });
        }
        
        // Search functionality
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('#file-list tr').forEach(row => {
              const fileNameElement = row.querySelector('.file-name');
              if (fileNameElement) {
                const fileName = fileNameElement.textContent.toLowerCase();
                row.style.display = fileName.includes(searchTerm) ? '' : 'none';
              }
            });
          });
        }

        // Filter functionality
        const filterSelect = document.getElementById('file-filter');
        if (filterSelect) {
          filterSelect.addEventListener('change', (e) => {
            const filterType = e.target.value;
            document.querySelectorAll('#file-list tr').forEach(row => {
              const fileTypeElement = row.querySelector('.file-type-badge');
              if (fileTypeElement) {
                const actualFileType = fileTypeElement.dataset.filetype; // Use data attribute
                if (filterType === 'all' || actualFileType === filterType) {
                  row.style.display = '';
                } else {
                  row.style.display = 'none';
                }
              }
            });
          });
        }

        // Drag and drop for upload
        const dropArea = document.getElementById('drop-area');
        const fileInput = document.getElementById('file-input');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          dropArea.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults (e) {
          e.preventDefault();
          e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
          dropArea.addEventListener(eventName, () => dropArea.classList.add('border-blue-500', 'bg-blue-50'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
          dropArea.addEventListener(eventName, () => dropArea.classList.remove('border-blue-500', 'bg-blue-50'), false);
        });

        dropArea.addEventListener('drop', handleDrop, false);

        function handleDrop(e) {
          const dt = e.dataTransfer;
          const files = dt.files;
          fileInput.files = files; // Assign dropped files to the input
          // Optional: Display file names selected or trigger upload automatically
          // document.querySelector('form').submit(); 
        }

        // Show selected file names
        if (fileInput) {
          fileInput.addEventListener('change', () => {
            const fileNamesContainer = document.getElementById('selected-files-names');
            fileNamesContainer.innerHTML = ''; // Clear previous names
            if (fileInput.files.length > 0) {
              Array.from(fileInput.files).forEach(file => {
                const p = document.createElement('p');
                p.textContent = file.name;
                p.className = 'text-xs text-gray-700';
                fileNamesContainer.appendChild(p);
              });
            }
          });
        }
      });
    </script>
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal">
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-4xl font-extrabold text-center text-gray-800 mb-10">
        <i class="fas fa-server text-blue-600 mr-3"></i> Advanced File Server
      </h1>
      
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <!-- Upload & Server Status Panel -->
        <div class="md:col-span-1 bg-white rounded-xl shadow-lg p-6">
          <h2 class="text-2xl font-bold mb-5 text-gray-700">Upload Files</h2>
          <form action="/upload" method="POST" enctype="multipart/form-data" class="flex flex-col">
            <div id="drop-area" class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4 cursor-pointer transition-all duration-200 hover:border-blue-500 hover:bg-blue-50"
                 onclick="document.getElementById('file-input').click()">
              <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-3"></i>
              <p class="text-gray-600 font-medium">Drag & Drop files here, or <span class="text-blue-600 hover:underline">click to browse</span></p>
              <p class="text-sm text-gray-500 mt-2">Max ${maxFiles} files, ${formatBytes(maxFileSize)} each</p>
              <input type="file" id="file-input" name="files" multiple class="hidden" accept="*/*">
              <div id="selected-files-names" class="mt-2 text-left text-sm text-gray-700"></div>
            </div>
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors duration-200 shadow-md">
              <i class="fas fa-upload mr-2"></i> Upload Files
            </button>
          </form>
          
          <div class="mt-10 pt-6 border-t border-gray-200">
            <h2 class="text-2xl font-bold mb-4 text-gray-700">Server Status</h2>
            <div class="space-y-4">
              <div class="flex items-center p-3 bg-green-50 rounded-lg shadow-sm">
                <div class="h-4 w-4 bg-green-500 rounded-full mr-3 animate-pulse"></div>
                <span class="font-semibold text-green-800">Online & Ready</span>
              </div>
              <div class="flex items-center">
                <i class="fas fa-microchip text-blue-500 text-2xl w-8"></i>
                <div>
                  <p class="font-semibold text-gray-700">System Info</p>
                  <p class="text-sm text-gray-600">Port: <span class="font-mono">${PORT}</span> | Files: <span class="font-mono">${files.length}</span></p>
                </div>
              </div>
              <div class="flex items-center">
                <i class="fas fa-users text-purple-500 text-2xl w-8"></i>
                <div>
                  <p class="font-semibold text-gray-700">Active Connections</p>
                  <p class="text-sm text-gray-600"><span class="font-mono">${connections}</span> (HTTP)</p>
                </div>
              </div>
              <div class="flex items-center">
                <i class="fas fa-history text-indigo-500 text-2xl w-8"></i>
                <div>
                  <p class="font-semibold text-gray-700">Activity Log</p>
                  <p class="text-sm text-gray-600"><span class="font-mono">${fileHistory.length}</span> actions logged</p>
                </div>
              </div>
              <a href="/history" class="block mt-6 text-blue-600 hover:text-blue-800 font-medium flex items-center transition-colors duration-200">
                <i class="fas fa-list-alt mr-2"></i> View full activity history
              </a>
            </div>
          </div>
        </div>
        
        <!-- File Manager Panel -->
        <div class="md:col-span-3 bg-white rounded-xl shadow-lg p-6">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between mb-6 border-b pb-4 border-gray-200">
            <h2 class="text-2xl font-bold text-gray-700 mb-4 md:mb-0">File Manager</h2>
            <div class="flex flex-wrap items-center space-y-3 md:space-y-0 md:space-x-3">
              <div class="relative w-full md:w-auto">
                <input 
                  type="text" 
                  id="search-input"
                  placeholder="Search files..." 
                  class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 w-full"
                >
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              </div>
              <select id="file-filter" class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 w-full md:w-auto">
                <option value="all">All Types</option>
                <option value="image">Images</option>
                <option value="pdf">PDFs</option>
                <option value="document">Documents</option>
                <option value="spreadsheet">Spreadsheets</option>
                <option value="presentation">Presentations</option>
                <option value="text">Text Files</option>
                <option value="code">Code Files</option>
                <option value="archive">Archives</option>
                <option value="audio">Audio</option>
                <option value="video">Video</option>
                <option value="other">Other</option>
              </select>
              <button 
                id="delete-selected"
                class="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg flex items-center transition-colors duration-200 shadow-md w-full md:w-auto"
              >
                <i class="fas fa-trash-alt mr-2"></i> Delete Selected
              </button>
            </div>
          </div>
          
          <div class="overflow-x-auto min-h-[500px] max-h-[700px] overflow-y-auto rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th class="px-6 py-3 text-left w-10">
                    <input type="checkbox" id="select-all" class="rounded text-blue-600 focus:ring-blue-500">
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Size</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Uploaded</th>
                  <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody id="file-list" class="bg-white divide-y divide-gray-200">
                ${files.length > 0 ? files.map(file => `
                <tr class="hover:bg-gray-50 transition-colors duration-150">
                  <td class="px-6 py-4">
                    <input type="checkbox" class="file-checkbox rounded text-blue-600 focus:ring-blue-500" value="${file.id}">
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex items-center">
                      <i class="fas ${file.icon} text-blue-500 mr-3 text-lg"></i>
                      <span class="file-name text-gray-800 font-medium">${file.name}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 file-type-badge" data-filetype="${file.type}">
                      ${file.type.charAt(0).toUpperCase() + file.type.slice(1).replace('_', ' ')}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-gray-600">${file.size}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-gray-600 text-sm">${file.uploaded}</td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex space-x-3">
                      <a href="${file.previewUrl}" class="text-blue-600 hover:text-blue-800 text-lg transition-colors duration-200" title="Preview">
                        <i class="fas fa-eye"></i>
                      </a>
                      <a href="${file.downloadUrl}" class="text-green-600 hover:text-green-800 text-lg transition-colors duration-200" title="Download">
                        <i class="fas fa-download"></i>
                      </a>
                      ${file.editUrl ? `
                      <a href="${file.editUrl}" class="text-yellow-600 hover:text-yellow-800 text-lg transition-colors duration-200" title="Edit">
                        <i class="fas fa-edit"></i>
                      </a>
                      ` : `
                      <span class="text-gray-400 text-lg cursor-not-allowed" title="Not editable">
                        <i class="fas fa-edit"></i>
                      </span>
                      `}
                      <button onclick="if(confirm('Are you sure you want to delete this file? This action cannot be undone.')) { fetch('/delete/${file.id}', { method: 'POST' }).then(() => window.location.reload()); }" 
                        class="text-red-600 hover:text-red-800 text-lg transition-colors duration-200" title="Delete">
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
                `).join('') : `
                <tr>
                  <td colspan="6" class="px-6 py-16 text-center text-gray-500">
                    <i class="fas fa-inbox text-5xl text-gray-300 mb-4"></i>
                    <p class="text-lg font-medium">No files uploaded yet.</p>
                    <p class="mt-2 text-sm">Use the upload panel on the left to get started!</p>
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
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal flex flex-col min-h-screen">
    <div class="bg-white shadow-md p-4">
      <div class="container mx-auto flex justify-between items-center">
        <h1 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-image text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-4">
          <a href="/download/${filename}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors duration-200 shadow">
            <i class="fas fa-download mr-2"></i> Download
          </a>
          <a href="/" class="text-gray-600 hover:text-gray-800 text-3xl transition-colors duration-200" title="Close Preview">
            <i class="fas fa-times"></i>
          </a>
        </div>
      </div>
    </div>
    
    <div class="flex-grow flex items-center justify-center p-8">
      <div class="bg-white rounded-lg shadow-xl p-6 max-w-full max-h-full flex justify-center items-center overflow-hidden">
        <img src="/download/${filename}" alt="${originalName}" class="max-w-full max-h-[80vh] object-contain rounded-lg">
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
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal flex flex-col min-h-screen">
    <div class="bg-white shadow-md p-4">
      <div class="container mx-auto flex justify-between items-center">
        <h1 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-file-pdf text-red-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-4">
          <a href="/download/${filename}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors duration-200 shadow">
            <i class="fas fa-download mr-2"></i> Download
          </a>
          <a href="/" class="text-gray-600 hover:text-gray-800 text-3xl transition-colors duration-200" title="Close Preview">
            <i class="fas fa-times"></i>
          </a>
        </div>
      </div>
    </div>
    
    <div class="flex-grow flex items-center justify-center p-4">
      <div class="bg-white rounded-lg shadow-xl overflow-hidden w-full h-[90vh]">
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
    <title>View: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal flex flex-col min-h-screen">
    <div class="bg-white shadow-md p-4">
      <div class="container mx-auto flex justify-between items-center">
        <h1 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-file-alt text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-4">
          <a href="/download/${filename}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors duration-200 shadow">
            <i class="fas fa-download mr-2"></i> Download
          </a>
          <a href="/edit/${filename}" class="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors duration-200 shadow">
            <i class="fas fa-edit mr-2"></i> Edit
          </a>
          <a href="/" class="text-gray-600 hover:text-gray-800 text-3xl transition-colors duration-200" title="Close Viewer">
            <i class="fas fa-times"></i>
          </a>
        </div>
      </div>
    </div>
    
    <div class="flex-grow flex items-center justify-center p-4">
      <div class="bg-gray-800 rounded-lg shadow-xl overflow-hidden w-full h-[90vh] flex flex-col">
        <div class="p-4 bg-gray-900 text-gray-300 border-b border-gray-700 flex items-center justify-between">
          <span class="font-mono text-sm">${originalName}</span>
          <span class="text-xs text-gray-500">${getFileType(filename).toUpperCase()} file</span>
        </div>
        <pre class="flex-grow p-6 font-mono text-sm text-gray-200 overflow-auto whitespace-pre-wrap"><code class="language-${getFileType(filename) === 'code' ? 'javascript' : 'text'}">${escapeHtml(content)}</code></pre>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderMediaPlayer(filename, originalName, mediaType) {
  const mediaTag = mediaType === 'audio' ? 'audio' : 'video';
  const icon = mediaType === 'audio' ? 'fa-file-audio' : 'fa-file-video';
  const color = mediaType === 'audio' ? 'text-purple-500' : 'text-teal-500';

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal flex flex-col min-h-screen">
    <div class="bg-white shadow-md p-4">
      <div class="container mx-auto flex justify-between items-center">
        <h1 class="text-2xl font-bold text-gray-800">
          <i class="fas ${icon} ${color} mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-4">
          <a href="/download/${filename}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors duration-200 shadow">
            <i class="fas fa-download mr-2"></i> Download
          </a>
          <a href="/" class="text-gray-600 hover:text-gray-800 text-3xl transition-colors duration-200" title="Close Viewer">
            <i class="fas fa-times"></i>
          </a>
        </div>
      </div>
    </div>
    
    <div class="flex-grow flex items-center justify-center p-4">
      <div class="bg-white rounded-lg shadow-xl overflow-hidden p-6 w-full max-w-4xl text-center">
        <h2 class="text-xl font-semibold mb-4 text-gray-700">Playing: ${originalName}</h2>
        <${mediaTag} controls class="w-full h-auto ${mediaTag === 'video' ? 'max-h-[70vh]' : ''} bg-black rounded-lg">
          <source src="/download/${filename}" type="${mediaType}/${path.extname(filename).slice(1)}">
          Your browser does not support the ${mediaTag} tag.
        </${mediaTag}>
        <p class="mt-4 text-sm text-gray-500">File size: ${formatBytes(fs.statSync(path.join(uploadDir, filename)).size)}</p>
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
    <title>Edit File: ${filename.split('-').slice(2).join('-')}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal flex flex-col min-h-screen">
    <div class="bg-white shadow-md p-4">
      <div class="container mx-auto flex justify-between items-center">
        <h1 class="text-2xl font-bold text-gray-800">
          <i class="fas fa-edit text-yellow-500 mr-2"></i>
          Editing: ${filename.split('-').slice(2).join('-')}
        </h1>
        <div class="flex space-x-4">
          <a href="/preview/${filename}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors duration-200 shadow">
            <i class="fas fa-eye mr-2"></i> Preview
          </a>
          <a href="/" class="text-gray-600 hover:text-gray-800 text-3xl transition-colors duration-200" title="Close Editor">
            <i class="fas fa-times"></i>
          </a>
        </div>
      </div>
    </div>
    
    <div class="flex-grow flex items-center justify-center p-4">
      <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-4xl">
        <form action="/save/${filename}" method="POST" class="flex flex-col h-[70vh]">
          <textarea 
            name="content" 
            rows="20" 
            class="flex-grow w-full p-4 font-mono text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-800 text-gray-200 outline-none resize-none"
            spellcheck="false"
          >${escapeHtml(content)}</textarea>
          <div class="mt-6 flex justify-end space-x-3">
            <a href="/preview/${filename}" class="bg-gray-500 hover:bg-gray-600 text-white font-bold px-5 py-2 rounded-lg transition-colors duration-200 shadow">
              Cancel
            </a>
            <button type="submit" class="bg-green-600 hover:bg-green-700 text-white font-bold px-5 py-2 rounded-lg transition-colors duration-200 shadow">
              <i class="fas fa-save mr-2"></i> Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderDefaultPreview(filename, originalName, size) {
  const fileType = getFileType(filename);
  const icon = getFileIcon(fileType);

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Info: ${originalName}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal flex flex-col min-h-screen">
    <div class="bg-white shadow-md p-4">
      <div class="container mx-auto flex justify-between items-center">
        <h1 class="text-2xl font-bold text-gray-800">
          <i class="fas ${icon} text-blue-500 mr-2"></i>
          ${originalName}
        </h1>
        <div class="flex space-x-4">
          <a href="/download/${filename}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors duration-200 shadow">
            <i class="fas fa-download mr-2"></i> Download
          </a>
          <a href="/" class="text-gray-600 hover:text-gray-800 text-3xl transition-colors duration-200" title="Close Info">
            <i class="fas fa-times"></i>
          </a>
        </div>
      </div>
    </div>
    
    <div class="flex-grow flex items-center justify-center p-8">
      <div class="bg-white rounded-lg shadow-xl p-8 text-center max-w-lg w-full">
        <i class="fas ${icon} text-8xl text-gray-400 mb-6"></i>
        <h2 class="text-3xl font-bold text-gray-800 mb-3">${originalName}</h2>
        <p class="text-lg text-gray-600 mb-2">Type: <span class="font-semibold">${fileType.charAt(0).toUpperCase() + fileType.slice(1).replace('_', ' ')}</span></p>
        <p class="text-lg text-gray-600 mb-6">Size: <span class="font-semibold">${formatBytes(size)}</span></p>
        <p class="text-gray-500 text-base">
          Preview is not available for this file type in the browser. <br>
          Please download the file to open it with a suitable application.
        </p>
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
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
    <style>
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 10px;
      }
      ::-webkit-scrollbar-thumb {
        background: #888;
        border-radius: 10px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: #555;
      }
    </style>
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal">
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-8 border-b pb-4 border-gray-200">
        <h1 class="text-3xl font-bold text-gray-800">
          <i class="fas fa-history text-purple-500 mr-2"></i>
          Activity History
        </h1>
        <a href="/" class="text-blue-600 hover:text-blue-800 font-medium flex items-center transition-colors duration-200">
          <i class="fas fa-arrow-left mr-2"></i> Back to File Manager
        </a>
      </div>
      
      <div class="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
        <div class="overflow-x-auto max-h-[80vh] overflow-y-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">File</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">IP Address</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${history.length > 0 ? history.map(entry => `
              <tr class="hover:bg-gray-50 transition-colors duration-150">
                <td class="px-6 py-4 whitespace-nowrap">
                  <span class="px-3 py-1 inline-flex items-center text-xs font-bold rounded-full 
                    ${entry.action === 'upload' ? 'bg-green-100 text-green-800' : ''}
                    ${entry.action === 'download' ? 'bg-blue-100 text-blue-800' : ''}
                    ${entry.action === 'edit' ? 'bg-yellow-100 text-yellow-800' : ''}
                    ${entry.action === 'delete' ? 'bg-red-100 text-red-800' : ''}
                  ">
                    <i class="fas 
                      ${entry.action === 'upload' ? 'fa-upload' : ''}
                      ${entry.action === 'download' ? 'fa-download' : ''}
                      ${entry.action === 'edit' ? 'fa-edit' : ''}
                      ${entry.action === 'delete' ? 'fa-trash-alt' : ''}
                      mr-1"></i>
                    ${entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-700 font-medium">${escapeHtml(entry.filename)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-600 text-sm">${new Date(entry.timestamp).toLocaleString()}</td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-600 text-sm font-mono">${escapeHtml(entry.ip)}</td>
              </tr>
              `).join('') : `
              <tr>
                <td colspan="4" class="px-6 py-16 text-center text-gray-500">
                  <i class="fas fa-clipboard-list text-5xl text-gray-300 mb-4"></i>
                  <p class="text-lg font-medium">No activity recorded yet.</p>
                  <p class="mt-2 text-sm">Perform some file operations to see the history here!</p>
                </td>
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
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-..." crossorigin="anonymous" referrerpolicy="no-referrer" />
  </head>
  <body class="bg-gray-100 font-sans leading-normal tracking-normal flex items-center justify-center min-h-screen">
    <div class="container mx-auto px-4 py-8">
      <div class="bg-red-50 border-l-4 border-red-500 p-6 rounded-lg shadow-lg max-w-2xl mx-auto">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <i class="fas fa-exclamation-circle text-red-500 text-4xl"></i>
          </div>
          <div class="ml-4">
            <h3 class="text-2xl font-bold text-red-800 mb-2">Oops! An Error Occurred.</h3>
            <div class="text-red-700 text-lg">
              <p>${escapeHtml(message)}</p>
            </div>
            <div class="mt-6">
              <a href="/" class="inline-flex items-center px-5 py-3 border border-transparent text-base font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 transition-colors duration-200 shadow-sm">
                <i class="fas fa-arrow-left mr-3"></i> Return to Dashboard
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

/**
 * Escapes HTML entities in a string to prevent XSS.
 * @param {string} text - The string to escape.
 * @returns {string} The escaped string.
 */
/**
 * Escapes HTML entities in a string to prevent XSS.
 * @param {string} text - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHtml(text) {
  const map = {
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": ''' // <-- यह लाइन ठीक की गई है
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}
// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ===========================================
  ⚡️ Advanced File Server is now Running! ⚡️
  ===========================================
  🚀 Access it at: http://localhost:${PORT}
  -------------------------------------------
  📁 File storage directory: ${path.resolve(uploadDir)}
  📦 Max upload file size: ${formatBytes(maxFileSize)}
  📄 Max files per upload: ${maxFiles}
  📜 Activity history limit: ${historyLimit} entries
  `);
});
