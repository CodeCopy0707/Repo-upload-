const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });
let fileHistory = [];

// Self-ping mechanism
setInterval(() => {
  fetch(`http://localhost:${PORT}/ping`)
    .then(res => console.log('Server pinged successfully'))
    .catch(err => console.error('Ping failed:', err));
}, 30000);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Routes
app.get('/ping', (req, res) => res.send('pong'));

app.get('/', (req, res) => {
  fs.readdir('uploads', (err, files) => {
    const fileList = files.map(file => {
      const filePath = path.join('uploads', file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: formatBytes(stats.size),
        uploaded: stats.birthtime.toLocaleString(),
        type: path.extname(file).slice(1) || 'file',
        downloadUrl: `/download/${file}`
      };
    });
    
    res.send(renderHTML(fileList));
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (req.file) {
    fileHistory.push({
      action: 'upload',
      filename: req.file.filename,
      timestamp: new Date().toISOString()
    });
  }
  res.redirect('/');
});

app.get('/view/:filename', (req, res) => {
  const filePath = path.join('uploads', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.send(renderFileView(req.params.filename, content));
  } else {
    res.status(404).send(renderError('File not found'));
  }
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join('uploads', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send(renderError('File not found'));
  }
});

app.post('/save/:filename', (req, res) => {
  const filePath = path.join('uploads', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, req.body.content);
    fileHistory.push({
      action: 'edit',
      filename: req.params.filename,
      timestamp: new Date().toISOString()
    });
    res.redirect('/');
  } else {
    res.status(404).send(renderError('File not found'));
  }
});

app.get('/delete/:filename', (req, res) => {
  const filePath = path.join('uploads', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    fileHistory.push({
      action: 'delete',
      filename: req.params.filename,
      timestamp: new Date().toISOString()
    });
  }
  res.redirect('/');
});

app.get('/history', (req, res) => {
  res.send(renderHistory(fileHistory));
});

// Helper functions
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// HTML Rendering functions with Tailwind CSS
function renderHTML(files) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Advanced File Server</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script>
      // Drag and drop functionality
      document.addEventListener('DOMContentLoaded', () => {
        const dropArea = document.querySelector('.drop-area');
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          dropArea.addEventListener(eventName, preventDefaults, false);
        });
        
        function preventDefaults(e) {
          e.preventDefault();
          e.stopPropagation();
        }
        
        ['dragenter', 'dragover'].forEach(eventName => {
          dropArea.addEventListener(eventName, highlight, false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
          dropArea.addEventListener(eventName, unhighlight, false);
        });
        
        function highlight() {
          dropArea.classList.add('border-blue-500', 'bg-blue-50');
        }
        
        function unhighlight() {
          dropArea.classList.remove('border-blue-500', 'bg-blue-50');
        }
        
        dropArea.addEventListener('drop', handleDrop, false);
        
        function handleDrop(e) {
          const dt = e.dataTransfer;
          const files = dt.files;
          document.querySelector('input[type="file"]').files = files;
        }
      });
    </script>
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <h1 class="text-3xl font-bold text-center mb-8">Advanced File Server</h1>
      
      <div class="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">Upload File</h2>
        <form action="/upload" method="POST" enctype="multipart/form-data" class="flex flex-col">
          <div class="drop-area border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4 cursor-pointer">
            <i class="fas fa-cloud-upload-alt text-4xl text-gray-400 mb-2"></i>
            <p class="text-gray-600">Drag & drop files here or click to browse</p>
            <input type="file" name="file" required class="mt-4 mx-auto">
          </div>
          <button type="submit" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center justify-center w-1/4 mx-auto">
            <i class="fas fa-upload mr-2"></i> Upload Files
          </button>
        </form>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold mb-4">File Manager</h2>
          ${files.length > 0 ? renderFileTable(files) : '<p class="text-gray-500 text-center py-8">No files uploaded yet</p>'}
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold mb-4">Server Status</h2>
          <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <div class="flex items-center">
              <div class="h-3 w-3 bg-green-500 rounded-full mr-2"></div>
              <span class="font-medium text-green-800">Online and Active</span>
            </div>
            <p class="mt-2 text-green-700">Server is automatically pinging itself every 30 seconds to prevent shutdown</p>
          </div>
          
          <div class="space-y-4">
            <div class="flex items-center">
              <i class="fas fa-microchip text-blue-500 text-xl w-8"></i>
              <div>
                <p class="font-semibold">System Information</p>
                <p class="text-sm text-gray-600">Port: ${PORT} | Files: ${files.length} | Platform: ${process.platform}</p>
              </div>
            </div>
            
            <div class="flex items-center">
              <i class="fas fa-history text-purple-500 text-xl w-8"></i>
              <div>
                <p class="font-semibold">Activity History</p>
                <p class="text-sm text-gray-600">${fileHistory.length} recorded actions</p>
              </div>
            </div>
            
            <a href="/history" class="inline-block mt-4 text-blue-500 hover:underline flex items-center">
              <i class="fas fa-list-alt mr-2"></i> View detailed activity log
            </a>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

function renderFileTable(files) {
  return `
  <div class="overflow-x-auto rounded-lg border border-gray-200">
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded</th>
          <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${files.map(file => `
        <tr class="hover:bg-gray-50">
          <td class="px-6 py-4 whitespace-nowrap">
            <div class="flex items-center">
              <i class="fas ${file.type === 'pdf' ? 'fa-file-pdf text-red-500' : 
                file.type === 'doc' || file.type === 'docx' ? 'fa-file-word text-blue-500' : 
                file.type === 'xls' || file.type === 'xlsx' ? 'fa-file-excel text-green-500' : 
                file.type === 'jpg' || file.type === 'jpeg' || file.type === 'png' ? 'fa-file-image text-yellow-500' : 
                'fa-file text-gray-400'} mr-2"></i>
              <span class="text-sm font-medium text-gray-900 truncate max-w-xs">${file.name}</span>
            </div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap">
            <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
              ${file.type.toUpperCase()}
            </span>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${file.size}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${file.uploaded}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
            <div class="flex space-x-2">
              <a href="${file.downloadUrl}" class="text-blue-600 hover:text-blue-900" title="Download">
                <i class="fas fa-download"></i>
              </a>
              <a href="/view/${file.name}" class="text-green-600 hover:text-green-900" title="View/Edit">
                <i class="fas fa-edit"></i>
              </a>
              <a href="/delete/${file.name}" class="text-red-600 hover:text-red-900" title="Delete">
                <i class="fas fa-trash"></i>
              </a>
            </div>
          </td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  `;
}

function renderFileView(filename, content) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Editing: ${filename}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100">
    <div class="container mx-auto px-4 py-8">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold flex items-center">
          <i class="fas fa-file-edit text-blue-500 mr-2"></i>
          Editing: ${filename}
        </h1>
        <a href="/" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times text-2xl"></i>
        </a>
      </div>
      
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <div class="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
          <div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              ${path.extname(filename).toUpperCase().slice(1)} FILE
            </span>
          </div>
          <a href="/download/${filename}" class="text-blue-500 hover:text-blue-700">
            <i class="fas fa-download mr-1"></i> Download Original
          </a>
        </div>
        
        <form action="/save/${filename}" method="POST">
          <textarea 
            name="content" 
            rows="25" 
            class="w-full p-4 font-mono text-sm border-none focus:ring-0"
            spellcheck="false"
          >${content}</textarea>
          <div class="bg-gray-50 px-4 py-3 border-t flex justify-end space-x-3">
            <a href="/" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded flex items-center">
              <i class="fas fa-times mr-2"></i> Cancel
            </a>
            <button type="submit" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center">
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
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-3xl font-bold flex items-center">
          <i class="fas fa-history text-purple-500 mr-3"></i>
          Server Activity History
        </h1>
        <a href="/" class="text-blue-500 hover:text-blue-700 flex items-center">
          <i class="fas fa-arrow-left mr-2"></i> Back to Files
        </a>
      </div>
      
      <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${history.map(entry => `
            <tr>
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                  entry.action === 'upload' ? 'bg-green-100 text-green-800' : 
                  entry.action === 'edit' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800'
                }">
                  <i class="fas ${
                    entry.action === 'upload' ? 'fa-upload' : 
                    entry.action === 'edit' ? 'fa-edit' : 'fa-trash'
                  } mr-1"></i>
                  ${entry.action.charAt(0).toUpperCase() + entry.action.slice(1)}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-xs">${entry.filename}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(entry.timestamp).toLocaleString()}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${entry.action === 'upload' ? 'New file added' : 
                 entry.action === 'edit' ? 'File content modified' : 
                 'File permanently deleted'}
              </td>
            </tr>
            `).reverse().join('')}
          </tbody>
        </table>
        
        ${history.length === 0 ? `
        <div class="text-center py-12">
          <i class="fas fa-inbox text-4xl text-gray-300 mb-4"></i>
          <p class="text-gray-500">No activity recorded yet</p>
        </div>
        ` : ''}
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
      <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg max-w-2xl mx-auto">
        <div class="flex">
          <div class="flex-shrink-0">
            <i class="fas fa-exclamation-circle text-red-500 text-2xl"></i>
          </div>
          <div class="ml-3">
            <h3 class="text-lg font-medium text-red-800">Operation Failed</h3>
            <div class="mt-2 text-red-700">
              <p>${message}</p>
            </div>
            <div class="mt-4">
              <a href="/" class="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none">
                <i class="fas fa-arrow-left mr-2"></i> Return to File Manager
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
app.listen(PORT, () => {
  console.log(`
  🚀 Server running at: http://localhost:${PORT}
  ⏰ Auto-ping enabled (every 30 seconds)
  📁 File storage: ${path.join(__dirname, 'uploads')}
  `);
});
