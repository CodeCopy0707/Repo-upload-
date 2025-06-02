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
const maxFileSize = 500 * 1024 * 1024; // Increased to 500MB
const maxFiles = 50; // Increased to 50 files per upload
// Updated allowed file types, ensuring common formats and general file types
const allowedFileTypes = /jpeg|jpg|png|gif|webp|bmp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|json|xml|md|log|js|html|css|php|py|c|cpp|java|sh|zip|tar|gz|rar|7z|mp3|wav|ogg|flac|mp4|mov|avi|webm|mkv|ico/;
const metadataFile = 'file_metadata.json'; // File to persist metadata
const historyFile = 'activity_history.json'; // File to persist history

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ======================
// Persistent Data Loading
// ======================
let fileMetadata = {};
let fileHistory = [];

function loadPersistentData() {
    try {
        if (fs.existsSync(metadataFile)) {
            fileMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
            console.log('Loaded file metadata from disk.');
        }
    } catch (e) {
        console.error('Error loading file metadata:', e);
        fileMetadata = {}; // Reset if corrupted
    }
    try {
        if (fs.existsSync(historyFile)) {
            fileHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
            console.log('Loaded activity history from disk.');
        }
    } catch (e) {
        console.error('Error loading activity history:', e);
        fileHistory = []; // Reset if corrupted
    }
}

function savePersistentData() {
    try {
        fs.writeFileSync(metadataFile, JSON.stringify(fileMetadata, null, 2));
        fs.writeFileSync(historyFile, JSON.stringify(fileHistory, null, 2));
        console.log('Saved file metadata and activity history to disk.');
    } catch (e) {
        console.error('Error saving persistent data:', e);
    }
}

// Load data when server starts
loadPersistentData();

// ======================
// Multer Storage Configuration
// ======================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Handle subdirectories for uploads if desired, based on req.body.currentPath
        const destPath = path.join(uploadDir, req.body.currentPath || '');
        if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
        }
        cb(null, destPath);
    },
    filename: (req, file, cb) => {
        const fileId = crypto.randomBytes(16).toString('hex'); // Unique ID for metadata tracking
        const uniqueSuffix = Date.now();
        const originalExtension = path.extname(file.originalname);
        const sanitizedName = path.basename(file.originalname, originalExtension).replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${uniqueSuffix}-${fileId}-${sanitizedName}${originalExtension}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: maxFileSize, files: maxFiles },
    fileFilter: (req, file, cb) => {
        const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedFileTypes.test(file.mimetype);

        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error(`File type not allowed for ${file.originalname}. Allowed types: ${allowedFileTypes.source}`));
        }
    }
});

let activeConnections = 0; // Track active connections

// ======================
// Helper Functions
// ======================
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileType(filename) {
    const ext = path.extname(filename).toLowerCase().slice(1);
    const typeMap = {
        jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image',
        pdf: 'pdf',
        doc: 'document', docx: 'document', xls: 'spreadsheet', xlsx: 'spreadsheet', ppt: 'presentation', pptx: 'presentation',
        txt: 'text', csv: 'text', json: 'text', md: 'text', xml: 'text', log: 'text',
        js: 'code', html: 'code', css: 'code', php: 'code', py: 'code', c: 'code', cpp: 'code', java: 'code', sh: 'code',
        zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive', '7z': 'archive',
        mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
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
        folder: 'fas fa-folder', // Added for folders
        other: 'fas fa-file'
    };
    return iconMap[fileType] || 'fas fa-file';
}

function logActivity(action, filename, req, fileId = 'N/A', currentPath = '/') {
    fileHistory.unshift({
        action,
        filename,
        fileId,
        timestamp: new Date().toISOString(),
        ip: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        currentPath: currentPath
        // userId: req.user ? req.user.id : 'guest' // Uncomment if authentication is implemented
    });

    if (fileHistory.length > 1000) { // Keep history manageable
        fileHistory.pop();
    }
    savePersistentData(); // Save history after each action
}

// Function to update file metadata (e.g., download count, last accessed)
function updateFileMetadata(fileId, updates) {
    if (fileMetadata[fileId]) {
        fileMetadata[fileId] = { ...fileMetadata[fileId], ...updates };
        savePersistentData(); // Save metadata after updates
    }
}

// Function to get metadata from filename (handles our specific naming convention)
function parseFilename(filename) {
    const parts = filename.split('-');
    if (parts.length < 3) return null; // Not a file managed by this system format (e.g., folder names)

    const uploadedTimestamp = parseInt(parts[0]);
    const fileId = parts[1];
    const originalName = parts.slice(2).join('-'); // Re-join if original name had hyphens

    if (isNaN(uploadedTimestamp) || !fileId || !originalName) return null;

    return { uploadedTimestamp, fileId, originalName };
}

// Helper to escape HTML to prevent XSS in displayed content
function escapeHtml(text) {
    if (typeof text !== 'string') return text; // Handle non-string inputs
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// ======================
// Middleware
// ======================
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(express.json()); // For parsing JSON bodies
// Serve static files from the 'public' directory
// Create a 'public' folder and put any assets there (e.g., custom CSS, JS)
app.use(express.static('public'));

// Middleware to set comprehensive security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); // Prevent clickjacking
    res.setHeader('X-XSS-Protection', '1; mode=block'); // Enable XSS filter
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'); // HSTS for HTTPS
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    // Content Security Policy (CSP) - IMPORTANT: Adjust this for your actual external resources!
    // Example: Allows scripts/styles from 'self' and the specified CDNs.
    // Ensure all external resources (like Font Awesome, Tailwind CDN) are listed.
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self'; script-src 'self' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; style-src 'self' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com;");

    activeConnections++;
    res.on('finish', () => {
        activeConnections--;
    });
    next();
});

// Basic authentication middleware (CONCEPTUAL - DO NOT USE IN PRODUCTION AS IS)
// For production, integrate with a proper authentication system (e.g., Passport.js, JWT, session management).
const authenticate = (req, res, next) => {
    // Example: Check for a simple header token
    // if (req.headers.authorization === 'Bearer your_secret_admin_token') {
    //     req.user = { id: 'admin', username: 'Administrator' };
    //     next();
    // } else if (req.path.startsWith('/admin')) { // Protect admin routes
    //     res.status(401).send(renderError('Unauthorized: Access to Admin Panel requires authentication.'));
    // } else {
    //     next(); // Allow public access to other routes for now
    // }
    next(); // For demonstration, everyone is "authenticated"
};
app.use(authenticate); // Apply authentication to all routes (adjust as needed)

// ======================
// Routes
// ======================
app.get('/ping', (req, res) => res.send('pong'));

// Main Dashboard route (handles listing files and folders in a given path)
app.get('/', (req, res) => {
    const currentPath = req.query.path ? path.normalize(req.query.path) : '';
    const absolutePath = path.join(uploadDir, currentPath);

    // Prevent directory traversal attacks
    if (!absolutePath.startsWith(uploadDir)) {
        return res.status(400).send(renderError('Invalid path provided.'));
    }

    fs.readdir(absolutePath, { withFileTypes: true }, (err, entries) => {
        if (err) {
            console.error('Directory read error:', err);
            // If path does not exist, redirect to root or show an error
            if (err.code === 'ENOENT') {
                 return res.status(404).send(renderError(`Directory "${escapeHtml(currentPath)}" not found.`));
            }
            return res.status(500).send(renderError('Server error: Could not list files.'));
        }

        const files = [];
        const folders = [];

        entries.forEach(entry => {
            const entryPath = path.join(currentPath, entry.name);
            const absoluteEntryPath = path.join(uploadDir, entryPath);

            try {
                if (entry.isDirectory()) {
                    folders.push({
                        id: entryPath,
                        name: entry.name,
                        type: 'folder',
                        icon: getFileIcon('folder'),
                        path: entryPath,
                        fullPath: absoluteEntryPath,
                        uploaded: 'N/A', // Folders don't have an upload timestamp in our scheme
                        size: 'N/A',
                        downloadUrl: null, // Folders are not directly downloadable like files
                        previewUrl: null,
                        editUrl: null
                    });
                } else if (entry.isFile()) {
                    const stats = fs.statSync(absoluteEntryPath);
                    const parsed = parseFilename(entry.name);

                    if (!parsed) {
                        // Handle files not conforming to our naming convention gracefully
                        files.push({
                            id: entry.name, // Use raw filename for non-managed files
                            fileId: 'N/A',
                            name: entry.name,
                            size: formatBytes(stats.size),
                            uploaded: new Date(stats.birthtime).toLocaleString(), // Use birthtime for non-managed
                            lastModified: new Date(stats.mtime).toLocaleString(),
                            type: getFileType(entry.name),
                            icon: getFileIcon(getFileType(entry.name)),
                            downloadUrl: `/download/${entryPath}`,
                            previewUrl: `/preview/${entryPath}`,
                            editUrl: (getFileType(entry.name) === 'text' || getFileType(entry.name) === 'code') ? `/edit/${entryPath}` : null,
                            downloads: 'N/A', // Not tracked for non-managed files
                            lastAccessed: 'N/A'
                        });
                        return;
                    }

                    const { uploadedTimestamp, fileId, originalName } = parsed;

                    // Ensure metadata exists for managed files, create if not
                    if (!fileMetadata[fileId]) {
                        fileMetadata[fileId] = {
                            id: fileId,
                            name: originalName,
                            size: stats.size,
                            uploaded: new Date(uploadedTimestamp).toISOString(),
                            type: getFileType(entry.name),
                            path: entryPath, // Store path relative to uploadDir
                            originalName: originalName,
                            downloads: 0,
                            lastAccessed: null,
                            lastModified: new Date(stats.mtime).toISOString()
                        };
                        savePersistentData();
                    } else {
                        // Update existing metadata (e.g., after an edit or move)
                        fileMetadata[fileId].size = stats.size;
                        fileMetadata[fileId].path = entryPath;
                        fileMetadata[fileId].lastModified = new Date(stats.mtime).toISOString();
                        fileMetadata[fileId].type = getFileType(entry.name); // Update type if extension changed
                        savePersistentData();
                    }

                    const fileEntry = fileMetadata[fileId];

                    files.push({
                        id: entryPath, // Full path relative to uploadDir for operations
                        fileId: fileId,
                        name: originalName,
                        size: formatBytes(fileEntry.size),
                        uploaded: new Date(fileEntry.uploaded).toLocaleString(),
                        lastModified: new Date(fileEntry.lastModified).toLocaleString(),
                        type: fileEntry.type,
                        icon: getFileIcon(fileEntry.type),
                        downloadUrl: `/download/${fileEntry.path}`,
                        previewUrl: `/preview/${fileEntry.path}`,
                        editUrl: (fileEntry.type === 'text' || fileEntry.type === 'code') ? `/edit/${fileEntry.path}` : null,
                        downloads: fileEntry.downloads,
                        lastAccessed: fileEntry.lastAccessed ? new Date(fileEntry.lastAccessed).toLocaleString() : 'Never'
                    });
                }
            } catch (e) {
                console.error(`Error processing entry ${entry.name}:`, e);
            }
        });

        // Sort folders first, then files alphabetically by name
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        res.send(renderDashboard(folders, files, currentPath));
        logActivity('view_folder', currentPath || '/', req);
    });
});

app.post('/upload', upload.array('files', maxFiles), (req, res) => {
    const currentPath = req.body.currentPath || ''; // Path where files are uploaded
    if (!req.files || req.files.length === 0) {
        return res.status(400).send(renderError('No files selected for upload.'));
    }

    req.files.forEach(file => {
        const parsed = parseFilename(file.filename);
        if (parsed) {
            const { fileId, originalName, uploadedTimestamp } = parsed;
            const fullFilePath = path.join(currentPath, file.filename); // Store path relative to uploadDir
            fileMetadata[fileId] = {
                id: fileId,
                name: originalName,
                size: file.size,
                uploaded: new Date(uploadedTimestamp).toISOString(),
                type: getFileType(file.filename),
                path: fullFilePath,
                originalName: originalName,
                downloads: 0,
                lastAccessed: null,
                lastModified: new Date().toISOString()
            };
            logActivity('upload', originalName, req, fileId, currentPath);
        } else {
            // For files not following the naming convention (e.g., dragged in directly)
            logActivity('upload', file.originalname, req, 'N/A', currentPath);
        }
    });
    savePersistentData();
    res.redirect(`/?path=${encodeURIComponent(currentPath)}`);
});

// Create Folder
app.post('/create-folder', (req, res) => {
    const folderName = req.body.folderName;
    const currentPath = req.body.currentPath || '';
    if (!folderName) {
        return res.status(400).send(renderError('Folder name cannot be empty.'));
    }

    const sanitizedFolderName = folderName.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!sanitizedFolderName) {
         return res.status(400).send(renderError('Invalid folder name. Please use alphanumeric characters, dots, hyphens, and underscores.'));
    }

    const folderPath = path.join(uploadDir, currentPath, sanitizedFolderName);

    fs.mkdir(folderPath, { recursive: true }, (err) => {
        if (err) {
            console.error('Error creating folder:', err);
            return res.status(500).send(renderError(`Failed to create folder "${escapeHtml(sanitizedFolderName)}". It might already exist.`));
        }
        logActivity('create_folder', sanitizedFolderName, req, 'N/A', currentPath);
        res.redirect(`/?path=${encodeURIComponent(currentPath)}`);
    });
});

app.get('/preview/:filepath(*)', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filepath);
    const relativePath = req.params.filepath;
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);

    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) { // Check if it's actually a file
        return res.status(404).send(renderError('File not found or is a directory.'));
    }

    const originalName = parsed ? parsed.originalName : filename;
    const fileId = parsed ? parsed.fileId : 'N/A';

    updateFileMetadata(fileId, { lastAccessed: new Date().toISOString() });
    logActivity('preview', originalName, req, fileId, path.dirname(relativePath));

    try {
        const fileType = getFileType(filename);

        if (fileType === 'image') {
            return res.send(renderImagePreview(relativePath, originalName));
        } else if (fileType === 'pdf') {
            return res.send(renderPDFPreview(relativePath, originalName));
        } else if (fileType === 'text' || fileType === 'code') {
            const content = fs.readFileSync(filePath, 'utf-8');
            return res.send(renderTextViewer(relativePath, originalName, content));
        } else if (fileType === 'audio') {
            return res.send(renderAudioPlayer(relativePath, originalName));
        } else if (fileType === 'video') {
            return res.send(renderVideoPlayer(relativePath, originalName));
        } else {
            const stats = fs.statSync(filePath);
            return res.send(renderDefaultPreview(relativePath, originalName, stats.size, fileType));
        }
    } catch (e) {
        console.error('Preview error:', e);
        res.status(500).send(renderError(`Error generating preview for ${escapeHtml(originalName)}.`));
    }
});

app.get('/download/:filepath(*)', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filepath);
    const relativePath = req.params.filepath;
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);

    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
        return res.status(404).send(renderError('File not found or is a directory for download.'));
    }

    const originalName = parsed ? parsed.originalName : filename;
    const fileId = parsed ? parsed.fileId : 'N/A';

    updateFileMetadata(fileId, { downloads: (fileMetadata[fileId] ? (fileMetadata[fileId].downloads || 0) + 1 : 1), lastAccessed: new Date().toISOString() });
    logActivity('download', originalName, req, fileId, path.dirname(relativePath));

    res.download(filePath, originalName, (err) => {
        if (err) {
            console.error(`Download error for ${originalName}:`, err);
            if (!res.headersSent) {
                res.status(500).send(renderError(`Could not download file ${escapeHtml(originalName)}.`));
            }
        }
    });
});

app.get('/edit/:filepath(*)', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filepath);
    const relativePath = req.params.filepath;
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);

    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
        return res.status(404).send(renderError('File not found or is a directory for editing.'));
    }

    const originalName = parsed ? parsed.originalName : filename;
    const fileId = parsed ? parsed.fileId : 'N/A';
    const fileType = getFileType(filename);

    if (fileType !== 'text' && fileType !== 'code') {
        return res.status(400).send(renderError(`Editing is only supported for text and code files. This is a ${fileType} file.`));
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        updateFileMetadata(fileId, { lastAccessed: new Date().toISOString() });
        res.send(renderFileEditor(relativePath, originalName, content));
    } catch (e) {
        console.error('Error reading file for edit:', e);
        res.status(500).send(renderError(`Error reading file ${escapeHtml(originalName)} for editing.`));
    }
});

app.post('/save/:filepath(*)', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filepath);
    const relativePath = req.params.filepath;
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);

    if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
        return res.status(404).send(renderError('File not found or is a directory for saving.'));
    }

    const originalName = parsed ? parsed.originalName : filename;
    const fileId = parsed ? parsed.fileId : 'N/A';
    const fileType = getFileType(filename);

    if (fileType !== 'text' && fileType !== 'code') {
        return res.status(400).send(renderError(`Saving is only supported for text and code files. This is a ${fileType} file.`));
    }

    try {
        fs.writeFileSync(filePath, req.body.content);
        const stats = fs.statSync(filePath);
        updateFileMetadata(fileId, { size: stats.size, lastModified: new Date().toISOString(), lastAccessed: new Date().toISOString() });
        logActivity('edit', originalName, req, fileId, path.dirname(relativePath));
        res.redirect(`/?path=${encodeURIComponent(path.dirname(relativePath))}`);
    } catch (e) {
        console.error('Error saving file:', e);
        res.status(500).send(renderError(`Error saving changes to ${escapeHtml(originalName)}.`));
    }
});

app.post('/delete/:filepath(*)', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filepath);
    const relativePath = req.params.filepath;
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);
    const isDirectory = fs.existsSync(filePath) && fs.lstatSync(filePath).isDirectory();

    if (!fs.existsSync(filePath)) {
        return res.status(404).send(renderError('Item not found for deletion.'));
    }

    const originalName = parsed ? parsed.originalName : filename;
    const fileId = parsed ? parsed.fileId : 'N/A';
    const currentPath = path.dirname(relativePath);

    try {
        if (isDirectory) {
            fs.rmSync(filePath, { recursive: true, force: true });
            logActivity('delete_folder', filename, req, 'N/A', currentPath);
        } else {
            fs.unlinkSync(filePath);
            delete fileMetadata[fileId]; // Remove from in-memory metadata
            logActivity('delete_file', originalName, req, fileId, currentPath);
        }
        savePersistentData();
        res.redirect(`/?path=${encodeURIComponent(currentPath)}`);
    } catch (e) {
        console.error('Error deleting item:', e);
        res.status(500).send(renderError(`Error deleting ${isDirectory ? 'folder' : 'file'} "${escapeHtml(originalName)}".`));
    }
});

app.post('/delete-multiple', (req, res) => {
    const itemsToDelete = Array.isArray(req.body.items) ? req.body.items : [];
    const currentPath = req.body.currentPath || '';
    let deletedCount = 0;
    let errorCount = 0;

    itemsToDelete.forEach(itemPath => {
        const fullItemPath = path.join(uploadDir, itemPath);
        const itemName = path.basename(itemPath);
        const parsed = parseFilename(itemName);
        const fileId = parsed ? parsed.fileId : 'N/A';

        if (fs.existsSync(fullItemPath)) {
            try {
                if (fs.lstatSync(fullItemPath).isDirectory()) {
                    fs.rmSync(fullItemPath, { recursive: true, force: true });
                    logActivity('delete_folder', itemName, req, 'N/A', currentPath);
                } else {
                    fs.unlinkSync(fullItemPath);
                    delete fileMetadata[fileId];
                    logActivity('delete_file', parsed ? parsed.originalName : itemName, req, fileId, currentPath);
                }
                deletedCount++;
            } catch (e) {
                console.error(`Error deleting item ${itemPath}:`, e);
                errorCount++;
            }
        } else {
            console.warn(`Attempted to delete non-existent item: ${itemPath}`);
            errorCount++;
        }
    });
    savePersistentData();

    if (errorCount > 0) {
        res.status(500).send(renderError(`Successfully deleted ${deletedCount} items, but encountered errors with ${errorCount} items.`));
    } else {
        res.redirect(`/?path=${encodeURIComponent(currentPath)}`);
    }
});

app.post('/rename/:filepath(*)', (req, res) => {
    const oldRelativePath = req.params.filepath;
    const oldAbsolutePath = path.join(uploadDir, oldRelativePath);
    const newName = req.body.newName;
    const currentPath = path.dirname(oldRelativePath);

    if (!fs.existsSync(oldAbsolutePath)) {
        return res.status(404).send(renderError('Item not found for renaming.'));
    }
    if (!newName) {
        return res.status(400).send(renderError('New name cannot be empty.'));
    }

    const isDirectory = fs.lstatSync(oldAbsolutePath).isDirectory();
    const oldFilename = path.basename(oldRelativePath);
    let newAbsolutePath;
    let newRelativePath;

    if (isDirectory) {
        const sanitizedNewName = newName.replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!sanitizedNewName) {
            return res.status(400).send(renderError('Invalid new folder name.'));
        }
        newAbsolutePath = path.join(path.dirname(oldAbsolutePath), sanitizedNewName);
        newRelativePath = path.join(currentPath, sanitizedNewName);
    } else {
        const oldExt = path.extname(oldFilename);
        const sanitizedBaseName = path.basename(newName, path.extname(newName)).replace(/[^a-zA-Z0-9._-]/g, '_');
        const newExt = path.extname(newName) || oldExt; // Keep old extension if new one is not provided
        if (!sanitizedBaseName) {
             return res.status(400).send(renderError('Invalid new file name.'));
        }
        newAbsolutePath = path.join(path.dirname(oldAbsolutePath), `${sanitizedBaseName}${newExt}`);
        newRelativePath = path.join(currentPath, `${sanitizedBaseName}${newExt}`);
    }

    // Check if new name already exists
    if (fs.existsSync(newAbsolutePath)) {
        return res.status(409).send(renderError(`Cannot rename: A ${isDirectory ? 'folder' : 'file'} with the name "${escapeHtml(newName)}" already exists.`));
    }

    try {
        fs.renameSync(oldAbsolutePath, newAbsolutePath);

        // Update metadata if it's a managed file
        const parsed = parseFilename(oldFilename);
        if (parsed && !isDirectory) {
            const fileId = parsed.fileId;
            if (fileMetadata[fileId]) {
                fileMetadata[fileId].name = path.basename(newRelativePath, path.extname(newRelativePath)); // Update original name in metadata
                fileMetadata[fileId].path = newRelativePath;
                fileMetadata[fileId].lastModified = new Date().toISOString();
                fileMetadata[fileId].type = getFileType(newRelativePath); // Update file type if extension changed
            }
        }
        savePersistentData();
        logActivity('rename', `${oldFilename} -> ${newName}`, req, parsed ? parsed.fileId : 'N/A', currentPath);
        res.redirect(`/?path=${encodeURIComponent(currentPath)}`);
    } catch (e) {
        console.error('Error renaming item:', e);
        res.status(500).send(renderError(`Error renaming ${isDirectory ? 'folder' : 'file'} "${escapeHtml(oldFilename)}" to "${escapeHtml(newName)}".`));
    }
});


app.post('/copy/:filepath(*)', (req, res) => {
    const sourceRelativePath = req.params.filepath;
    const sourceAbsolutePath = path.join(uploadDir, sourceRelativePath);
    const destinationPath = req.body.destinationPath || path.dirname(sourceRelativePath); // Default to current folder
    const currentPath = path.dirname(sourceRelativePath); // For redirection

    if (!fs.existsSync(sourceAbsolutePath)) {
        return res.status(404).send(renderError('Source item not found for copying.'));
    }

    const isDirectory = fs.lstatSync(sourceAbsolutePath).isDirectory();
    const itemName = path.basename(sourceRelativePath);
    let newFilename = itemName;

    // Generate a new name for the copied item (e.g., 'filename_copy.ext' or 'folder_copy')
    let copyCount = 0;
    let tempNewFilename = newFilename;
    while (fs.existsSync(path.join(uploadDir, destinationPath, tempNewFilename))) {
        copyCount++;
        const ext = path.extname(itemName);
        const base = path.basename(itemName, ext);
        tempNewFilename = `${base}_copy${copyCount}${ext}`;
    }
    newFilename = tempNewFilename;

    const destinationAbsolutePath = path.join(uploadDir, destinationPath, newFilename);
    const destinationRelativePath = path.join(destinationPath, newFilename);

    try {
        fs.copyFileSync(sourceAbsolutePath, destinationAbsolutePath);

        if (!isDirectory) { // If it's a file, create new metadata entry
            const sourceParsed = parseFilename(itemName);
            if (sourceParsed) {
                const newFileId = crypto.randomBytes(16).toString('hex');
                const newUploadedTimestamp = Date.now();
                const newFileManagedName = `${newUploadedTimestamp}-${newFileId}-${sourceParsed.originalName}`;
                const newFullPathManaged = path.join(path.dirname(destinationAbsolutePath), newFileManagedName);

                fs.renameSync(destinationAbsolutePath, newFullPathManaged); // Rename copied file to managed format

                fileMetadata[newFileId] = {
                    id: newFileId,
                    name: sourceParsed.originalName,
                    size: fs.statSync(newFullPathManaged).size,
                    uploaded: new Date(newUploadedTimestamp).toISOString(),
                    type: getFileType(sourceParsed.originalName),
                    path: path.join(destinationPath, newFileManagedName), // Relative path for metadata
                    originalName: sourceParsed.originalName,
                    downloads: 0,
                    lastAccessed: null,
                    lastModified: new Date().toISOString()
                };
                logActivity('copy', `${itemName} to ${newFilename}`, req, newFileId, destinationPath);
            } else {
                 logActivity('copy', `${itemName} to ${newFilename} (unmanaged)`, req, 'N/A', destinationPath);
            }
        } else {
            // For folders, recursive copy might be needed (more complex with fs.promises.cp or custom walk)
            // For now, this only copies empty folders or single files
            logActivity('copy_folder', `${itemName} to ${newFilename}`, req, 'N/A', destinationPath);
        }
        savePersistentData();
        res.redirect(`/?path=${encodeURIComponent(currentPath)}`);
    } catch (e) {
        console.error('Error copying item:', e);
        res.status(500).send(renderError(`Error copying ${isDirectory ? 'folder' : 'file'} "${escapeHtml(itemName)}".`));
    }
});


// Route for file sharing (generates a temporary, shareable link)
app.get('/share/:filepath(*)', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filepath);
    const relativePath = req.params.filepath;
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);

    if (!fs.existsSync(filePath) || (!fs.lstatSync(filePath).isFile() && !fs.lstatSync(filePath).isDirectory())) {
        return res.status(404).send(renderError('Item not found for sharing.'));
    }

    const originalName = parsed ? parsed.originalName : filename;
    const fileId = parsed ? parsed.fileId : 'N/A';

    logActivity('share', originalName, req, fileId, path.dirname(relativePath));
    // The share link is essentially the download link for now, could be a dedicated /s/:token route
    const shareableLink = `${req.protocol}://${req.get('host')}/download/${encodeURIComponent(relativePath)}`;
    res.send(renderShareLink(originalName, shareableLink));
});

// Admin Panel
app.get('/admin', authenticate, (req, res) => {
    const files = Object.values(fileMetadata); // Get array of all file metadata
    const systemInfo = {
        totalFiles: files.length,
        totalStorageUsed: formatBytes(files.reduce((sum, f) => sum + f.size, 0)),
        activeConnections: activeConnections,
        maxFileSize: formatBytes(maxFileSize),
        maxFilesPerUpload: maxFiles,
        allowedFileTypes: allowedFileTypes.source.replace(/\|/g, ', ')
    };
    res.send(renderAdminPanel(systemInfo, fileMetadata, fileHistory));
});

// Get all files and folders (for API or advanced search/management)
app.get('/api/files', (req, res) => {
    const currentPath = req.query.path ? path.normalize(req.query.path) : '';
    const absolutePath = path.join(uploadDir, currentPath);

    if (!absolutePath.startsWith(uploadDir)) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    fs.readdir(absolutePath, { withFileTypes: true }, (err, entries) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read directory' });
        }

        const items = entries.map(entry => {
            const itemRelativePath = path.join(currentPath, entry.name);
            const itemAbsolutePath = path.join(uploadDir, itemRelativePath);

            try {
                if (entry.isDirectory()) {
                    return {
                        id: itemRelativePath,
                        name: entry.name,
                        type: 'folder',
                        isManaged: false,
                        icon: getFileIcon('folder'),
                        path: itemRelativePath,
                        uploaded: 'N/A',
                        size: 'N/A',
                        lastModified: fs.statSync(itemAbsolutePath).mtime.toISOString()
                    };
                } else {
                    const stats = fs.statSync(itemAbsolutePath);
                    const parsed = parseFilename(entry.name);
                    const fileId = parsed ? parsed.fileId : 'N/A';
                    const originalName = parsed ? parsed.originalName : entry.name;
                    const isManaged = !!parsed;

                    let fileInfo = {
                        id: itemRelativePath,
                        name: originalName,
                        size: formatBytes(stats.size),
                        uploaded: new Date(stats.birthtime).toISOString(), // Default to birthtime
                        lastModified: new Date(stats.mtime).toISOString(),
                        type: getFileType(entry.name),
                        icon: getFileIcon(getFileType(entry.name)),
                        path: itemRelativePath,
                        isManaged: isManaged,
                        downloads: 'N/A',
                        lastAccessed: 'N/A'
                    };

                    if (isManaged && fileMetadata[fileId]) {
                        fileInfo.uploaded = fileMetadata[fileId].uploaded;
                        fileInfo.downloads = fileMetadata[fileId].downloads;
                        fileInfo.lastAccessed = fileMetadata[fileId].lastAccessed;
                    }
                    return fileInfo;
                }
            } catch (e) {
                console.error(`API: Error processing item ${entry.name}:`, e);
                return null;
            }
        }).filter(item => item !== null);

        res.json(items);
    });
});

app.get('/history', (req, res) => {
    res.send(renderHistory(fileHistory));
});

// Error handling middleware (catch-all for routes not found)
app.use((req, res, next) => {
    res.status(404).send(renderError(`404: The requested URL ${req.originalUrl} was not found.`));
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send(renderError(`Something broke! Server Error: ${err.message}`));
});


// ======================
// Rendering Functions (HTML Templates using Tailwind CSS and Font Awesome)
// ======================
// Note: These functions generate HTML strings. The actual CSS and JS interactivity
// are handled by the browser loading Tailwind CDN and the inline/app.js scripts.

function renderBreadcrumbs(currentPath) {
    const parts = currentPath.split(path.sep).filter(p => p); // Split by platform-specific separator
    let breadcrumbsHtml = '<a href="/" class="text-blue-600 hover:text-blue-800"><i class="fas fa-home mr-1"></i>Home</a>';
    let currentLink = '';

    parts.forEach((part, index) => {
        currentLink = path.join(currentLink, part);
        breadcrumbsHtml += ` <span class="text-gray-400 mx-1">/</span> <a href="/?path=${encodeURIComponent(currentLink)}" class="text-blue-600 hover:text-blue-800">${escapeHtml(part)}</a>`;
    });
    return breadcrumbsHtml;
}


function renderDashboard(folders, files, currentPath) {
    const parentPath = currentPath ? path.dirname(currentPath) : '';
    const displayParentLink = currentPath !== '';
    const totalItems = folders.length + files.length;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>File Explorer - ${escapeHtml(currentPath || 'Home')}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            /* Custom Scrollbars */
            ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }
            ::-webkit-scrollbar-thumb {
                background-color: #cbd5e0; /* gray-400 */
                border-radius: 4px;
            }
            ::-webkit-scrollbar-track {
                background-color: #f7fafc; /* gray-50 */
            }

            /* Context Menu Styling */
            .context-menu {
                position: absolute;
                background-color: white;
                border: 1px solid #e2e8f0; /* gray-200 */
                border-radius: 0.5rem;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                z-index: 1000;
                min-width: 150px;
            }
            .context-menu-item {
                padding: 0.75rem 1rem;
                cursor: pointer;
                display: flex;
                align-items: center;
                transition: background-color 0.1s ease-in-out;
            }
            .context-menu-item:hover {
                background-color: #f7fafc; /* gray-50 */
            }
            .context-menu-item:first-child {
                border-top-left-radius: 0.5rem;
                border-top-right-radius: 0.5rem;
            }
            .context-menu-item:last-child {
                border-bottom-left-radius: 0.5rem;
                border-bottom-right-radius: 0.5rem;
            }
            .context-menu-item i {
                margin-right: 0.75rem;
            }
            .context-menu-separator {
                border-top: 1px solid #e2e8f0; /* gray-200 */
                margin: 0.25rem 0;
            }
            /* File and Folder Grid View */
            .grid-view-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                padding: 1rem;
                border: 1px solid #e2e8f0;
                border-radius: 0.75rem;
                background-color: white;
                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                transition: all 0.2s ease-in-out;
                cursor: pointer;
            }
            .grid-view-item:hover {
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba[0](0, 0, 0, 0.06);
                transform: translateY(-2px);
                border-color: #3b82f6; /* blue-500 */
            }
            .grid-view-item i {
                font-size: 3rem;
                margin-bottom: 0.75rem;
                color: #60a5fa; /* blue-400 */
            }
            .grid-view-item .item-name {
                font-weight: 600;
                color: #1f2937; /* gray-900 */
                word-break: break-all;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                width: 100%;
            }
            .grid-view-item .item-info {
                font-size: 0.875rem;
                color: #6b7280; /* gray-500 */
            }
        </style>
    </head>
    <body class="bg-gray-100 font-sans antialiased text-gray-900">
        <div class="container mx-auto px-4 py-8">
            <h1 class="text-4xl font-extrabold text-center mb-6 text-gray-800">
                <i class="fas fa-server mr-3 text-indigo-600"></i> Advanced File Server
            </h1>

            <div class="bg-white rounded-xl shadow-lg p-6 mb-8">
                <div class="flex items-center justify-between mb-4">
                    <div class="text-sm font-medium text-gray-600">
                        ${renderBreadcrumbs(currentPath)}
                    </div>
                     <div class="flex items-center space-x-4 text-gray-600 text-sm">
                        <span><i class="fas fa-globe mr-1"></i> Active Connections: <span id="active-connections">${activeConnections}</span></span>
                        <span><i class="fas fa-hdd mr-1"></i> Total Files: ${totalItems}</span>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div class="md:col-span-1 bg-gray-50 rounded-lg shadow-inner p-6">
                        <h2 class="text-xl font-semibold mb-5 text-gray-700">Actions</h2>
                        <form id="upload-form" action="/upload" method="POST" enctype="multipart/form-data" class="flex flex-col space-y-4 mb-6">
                            <input type="hidden" name="currentPath" value="${escapeHtml(currentPath)}">
                            <div id="drop-area" class="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center cursor-pointer transition-all duration-200 hover:border-blue-500 hover:bg-blue-50"
                                 onclick="document.getElementById('file-input').click()">
                                <i class="fas fa-cloud-upload-alt text-5xl text-blue-400 mb-3"></i>
                                <p class="text-gray-600 font-medium">Drag & Drop files here, or Click to Browse</p>
                                <p class="text-sm text-gray-500 mt-2">Max ${maxFiles} files, ${formatBytes(maxFileSize)} each</p>
                                <input type="file" id="file-input" name="files" multiple class="hidden" accept="${allowedFileTypes.source.replace(/\|/g, ',.')}">
                            </div>
                            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 flex items-center justify-center">
                                <i class="fas fa-upload mr-3"></i> Upload Selected
                            </button>
                        </form>

                        <button onclick="showCreateFolderModal('${escapeHtml(currentPath)}')" class="w-full bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 flex items-center justify-center mb-4">
                            <i class="fas fa-folder-plus mr-3"></i> Create New Folder
                        </button>

                        <button id="delete-selected" class="w-full bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 flex items-center justify-center mb-4">
                            <i class="fas fa-trash mr-3"></i> Delete Selected
                        </button>

                        <a href="/history" class="block w-full bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 flex items-center justify-center mb-4">
                            <i class="fas fa-history mr-3"></i> View Activity Log
                        </a>
                         <a href="/admin" class="block w-full bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-lg text-lg font-semibold transition-colors duration-200 flex items-center justify-center">
                            <i class="fas fa-user-cog mr-3"></i> Admin Panel
                        </a>
                    </div>

                    <div class="md:col-span-3 bg-white rounded-xl shadow-lg p-6">
                        <div class="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
                            <h2 class="text-xl font-semibold mb-4 md:mb-0 text-gray-700">Files & Folders</h2>
                            <div class="flex flex-col md:flex-row space-y-3 md:space-y-0 md:space-x-3 w-full md:w-auto">
                                <div class="relative w-full md:w-auto">
                                    <input
                                      type="text"
                                      id="search-input"
                                      placeholder="Search files and folders..."
                                      class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
                                    >
                                    <i class="fas fa-search absolute left-3 top-3 text-gray-400"></i>
                                </div>
                                <select id="sort-select" class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                                    <option value="name-asc">Name (A-Z)</option>
                                    <option value="name-desc">Name (Z-A)</option>
                                    <option value="uploaded-desc">Uploaded (Newest)</option>
                                    <option value="uploaded-asc">Uploaded (Oldest)</option>
                                    <option value="size-desc">Size (Largest)</option>
                                    <option value="size-asc">Size (Smallest)</option>
                                </select>
                                <button id="toggle-view" class="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                                    <i class="fas fa-th-large mr-2" id="view-icon"></i> <span id="view-text">Grid View</span>
                                </button>
                            </div>
                        </div>

                        ${displayParentLink ? `
                        <div class="mb-4">
                            <a href="/?path=${encodeURIComponent(parentPath)}" class="text-blue-600 hover:text-blue-800 flex items-center font-medium">
                                <i class="fas fa-level-up-alt mr-2"></i> Up to Parent Directory
                            </a>
                        </div>
                        ` : ''}

                        <div id="file-list-container" class="overflow-x-auto rounded-lg border border-gray-200">
                            <table id="list-view" class="min-w-full divide-y divide-gray-200 ${totalItems === 0 ? 'hidden' : ''}">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-6 py-3 text-left w-10">
                                            <input type="checkbox" id="select-all" class="rounded text-blue-600 focus:ring-blue-500">
                                        </th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded / Modified</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Downloads</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="file-list" class="bg-white divide-y divide-gray-200">
                                    ${totalItems > 0 ? (
                                        folders.map(folder => `
                                        <tr class="hover:bg-gray-50 transition-colors duration-100 file-item" data-name="${escapeHtml(folder.name)}" data-type="folder">
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <input type="checkbox" class="file-checkbox rounded text-blue-600 focus:ring-blue-500" value="${escapeHtml(folder.path)}">
                                            </td>
                                            <td class="px-6 py-4 whitespace-nowrap cursor-pointer" ondblclick="window.location.href='/?path=${encodeURIComponent(folder.path)}'">
                                                <div class="flex items-center">
                                                    <i class="${folder.icon} text-yellow-500 mr-3 text-lg"></i>
                                                    <span class="file-name text-gray-800 font-medium">${escapeHtml(folder.name)}</span>
                                                </div>
                                            </td>
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <span class="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">FOLDER</span>
                                            </td>
                                            <td class="px-6 py-4 whitespace-nowrap text-gray-700">${folder.size}</td>
                                            <td class="px-6 py-4 whitespace-nowrap text-gray-700">N/A</td>
                                            <td class="px-6 py-4 whitespace-nowrap text-gray-700">N/A</td>
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <div class="flex space-x-4">
                                                    <a href="/?path=${encodeURIComponent(folder.path)}" class="text-blue-600 hover:text-blue-800 transition-colors duration-200" title="Open Folder">
                                                        <i class="fas fa-folder-open text-lg"></i>
                                                    </a>
                                                    <button onclick="showRenameModal('${escapeHtml(folder.path)}', '${escapeHtml(folder.name)}', true)" class="text-yellow-600 hover:text-yellow-800 transition-colors duration-200" title="Rename">
                                                        <i class="fas fa-edit text-lg"></i>
                                                    </button>
                                                    <button onclick="showCopyModal('${escapeHtml(folder.path)}', '${escapeHtml(folder.name)}', true, '${escapeHtml(currentPath)}')">
                                                        <i class="fas fa-copy text-lg text-purple-600 hover:text-purple-800" title="Copy"></i>
                                                    </button>
                                                    <button onclick="if(confirm('Are you absolutely sure you want to delete folder \'${escapeHtml(folder.name)}\' and its contents? This cannot be undone.')) window.location.href='/delete/${encodeURIComponent(folder.path)}'"
                                                        class="text-red-600 hover:text-red-800 transition-colors duration-200" title="Delete">
                                                        <i class="fas fa-trash text-lg"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        `).join('') +
                                        files.map(file => `
                                        <tr class="hover:bg-gray-50 transition-colors duration-100 file-item" data-name="${escapeHtml(file.name)}" data-type="${escapeHtml(file.type)}" data-size="${file.size}" data-uploaded="${file.uploaded}">
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <input type="checkbox" class="file-checkbox rounded text-blue-600 focus:ring-blue-500" value="${escapeHtml(file.id)}">
                                            </td>
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <div class="flex items-center">
                                                    <i class="${file.icon} text-blue-500 mr-3 text-lg"></i>
                                                    <span class="file-name text-gray-800 font-medium">${escapeHtml(file.name)}</span>
                                                </div>
                                            </td>
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <span class="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                                                    ${escapeHtml(file.type.toUpperCase())}
                                                </span>
                                            </td>
                                            <td class="px-6 py-4 whitespace-nowrap text-gray-700">${file.size}</td>
                                            <td class="px-6 py-4 whitespace-nowrap text-gray-700" title="Uploaded: ${file.uploaded} \nLast Modified: ${file.lastModified}">${file.uploaded}</td>
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
                                                    <button onclick="showRenameModal('${escapeHtml(file.id)}', '${escapeHtml(file.name)}', false)" class="text-yellow-600 hover:text-yellow-800 transition-colors duration-200" title="Rename">
                                                        <i class="fas fa-i-cursor text-lg"></i>
                                                    </button>
                                                    <button onclick="showCopyModal('${escapeHtml(file.id)}', '${escapeHtml(file.name)}', false, '${escapeHtml(currentPath)}')">
                                                        <i class="fas fa-copy text-lg text-purple-600 hover:text-purple-800" title="Copy"></i>
                                                    </button>
                                                    <a href="/share/${encodeURIComponent(file.id)}" class="text-purple-600 hover:text-purple-800 transition-colors duration-200" title="Share">
                                                        <i class="fas fa-share-alt text-lg"></i>
                                                    </a>
                                                    <button onclick="if(confirm('Are you absolutely sure you want to delete \'${escapeHtml(file.name)}\'? This cannot be undone.')) window.location.href='/delete/${encodeURIComponent(file.id)}'"
                                                        class="text-red-600 hover:text-red-800 transition-colors duration-200" title="Delete">
                                                        <i class="fas fa-trash text-lg"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        `).join('')
                                    ) : `
                                    <tr>
                                        <td colspan="7" class="px-6 py-16 text-center text-gray-500">
                                            <i class="fas fa-inbox text-5xl text-gray-300 mb-4"></i>
                                            <p class="text-lg">This folder is empty. Start by uploading files or creating a new folder!</p>
                                        </td>
                                    </tr>
                                    `}
                                </tbody>
                            </table>

                            <div id="grid-view" class="hidden grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 p-4">
                                ${totalItems > 0 ? (
                                    folders.map(folder => `
                                        <div class="grid-view-item file-item" data-name="${escapeHtml(folder.name)}" data-type="folder" ondblclick="window.location.href='/?path=${encodeURIComponent(folder.path)}'" data-item-path="${escapeHtml(folder.path)}" data-is-folder="true">
                                            <input type="checkbox" class="file-checkbox absolute top-2 left-2 rounded text-blue-600 focus:ring-blue-500">
                                            <i class="${folder.icon} text-yellow-500"></i>
                                            <span class="item-name">${escapeHtml(folder.name)}</span>
                                            <span class="item-info">Folder</span>
                                        </div>
                                    `).join('') +
                                    files.map(file => `
                                        <div class="grid-view-item file-item" data-name="${escapeHtml(file.name)}" data-type="${escapeHtml(file.type)}" data-size="${file.size}" data-uploaded="${file.uploaded}" data-item-path="${escapeHtml(file.id)}" data-is-folder="false">
                                            <input type="checkbox" class="file-checkbox absolute top-2 left-2 rounded text-blue-600 focus:ring-blue-500">
                                            <i class="${file.icon} text-blue-500"></i>
                                            <span class="item-name">${escapeHtml(file.name)}</span>
                                            <span class="item-info">${file.size}</span>
                                        </div>
                                    `).join('')
                                ) : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        ${renderCreateFolderModal()}
        ${renderRenameModal()}
        ${renderCopyModal()}

        <div id="context-menu" class="context-menu hidden">
            <div class="context-menu-item" id="context-open">
                <i class="fas fa-folder-open"></i> Open
            </div>
            <div class="context-menu-item" id="context-preview">
                <i class="fas fa-eye"></i> Preview
            </div>
            <div class="context-menu-item" id="context-download">
                <i class="fas fa-download"></i> Download
            </div>
            <div class="context-menu-item" id="context-edit">
                <i class="fas fa-edit"></i> Edit
            </div>
            <div class="context-menu-item" id="context-rename">
                <i class="fas fa-i-cursor"></i> Rename
            </div>
            <div class="context-menu-item" id="context-copy">
                <i class="fas fa-copy"></i> Copy
            </div>
            <div class="context-menu-item" id="context-share">
                <i class="fas fa-share-alt"></i> Share
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item text-red-600" id="context-delete">
                <i class="fas fa-trash"></i> Delete
            </div>
        </div>

        <script>
            // Global variables for modals
            let currentItemPath = '';
            let currentItemName = '';
            let isCurrentItemFolder = false;
            const currentDirectoryPath = '${escapeHtml(currentPath)}'; // Used in JS for actions

            // --- Modal Functions ---
            function showCreateFolderModal(path) {
                document.getElementById('create-folder-path').value = path;
                document.getElementById('create-folder-modal').classList.remove('hidden');
            }
            function hideCreateFolderModal() {
                document.getElementById('create-folder-modal').classList.add('hidden');
                document.getElementById('new-folder-name').value = ''; // Clear input
            }

            function showRenameModal(itemPath, itemName, isFolder) {
                currentItemPath = itemPath;
                currentItemName = itemName;
                isCurrentItemFolder = isFolder;
                document.getElementById('rename-old-name').textContent = itemName;
                document.getElementById('new-item-name').value = itemName;
                document.getElementById('rename-modal').classList.remove('hidden');
            }
            function hideRenameModal() {
                document.getElementById('rename-modal').classList.add('hidden');
            }

            function showCopyModal(itemPath, itemName, isFolder, currentDir) {
                currentItemPath = itemPath;
                currentItemName = itemName;
                isCurrentItemFolder = isFolder;
                document.getElementById('copy-item-name').textContent = itemName;
                document.getElementById('copy-destination-path').value = currentDir; // Default to current directory
                document.getElementById('copy-modal').classList.remove('hidden');
            }
            function hideCopyModal() {
                document.getElementById('copy-modal').classList.add('hidden');
            }


            // --- Dashboard Interactivity ---
            document.addEventListener('DOMContentLoaded', () => {
                const dropArea = document.getElementById('drop-area');
                const fileInput = document.getElementById('file-input');
                const selectAllCheckbox = document.getElementById('select-all');
                const fileCheckboxes = document.querySelectorAll('.file-checkbox');
                const deleteSelectedButton = document.getElementById('delete-selected');
                const searchInput = document.getElementById('search-input');
                const sortSelect = document.getElementById('sort-select');
                const toggleViewButton = document.getElementById('toggle-view');
                const listView = document.getElementById('list-view');
                const gridView = document.getElementById('grid-view');
                const viewIcon = document.getElementById('view-icon');
                const viewText = document.getElementById('view-text');
                const fileListContainer = document.getElementById('file-list-container');
                const fileItems = document.querySelectorAll('.file-item'); // Both list and grid items

                let currentView = 'list'; // 'list' or 'grid'

                // Load preferred view from local storage
                if (localStorage.getItem('fileView') === 'grid') {
                    toggleView(); // Switch to grid view on load
                }

                // Drag and Drop Upload
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
                        alert('Files ready for upload. Click "Upload Selected" to proceed.');
                    }
                });

                // Select All Checkbox
                selectAllCheckbox.addEventListener('change', (e) => {
                    document.querySelectorAll('.file-checkbox').forEach(checkbox => {
                        checkbox.checked = e.target.checked;
                    });
                });

                // Bulk Delete
                deleteSelectedButton.addEventListener('click', () => {
                    const selectedItems = Array.from(document.querySelectorAll('.file-checkbox:checked'))
                        .map(checkbox => checkbox.value);

                    if (selectedItems.length === 0) {
                        alert('Please select files or folders to delete.');
                        return;
                    }

                    if (confirm('Are you sure you want to delete ' + selectedItems.length + ' selected items? This action cannot be undone.')) {
                        fetch('/delete-multiple', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ items: selectedItems, currentPath: currentDirectoryPath })
                        })
                        .then(response => {
                            if (response.ok) {
                                window.location.reload();
                            } else {
                                response.text().then(text => alert('Failed to delete items: ' + text));
                            }
                        })
                        .catch(error => alert('Network error: ' + error.message));
                    }
                });

                // Search Functionality
                searchInput.addEventListener('input', () => {
                    filterAndSortFiles();
                });

                // Sort Functionality
                sortSelect.addEventListener('change', () => {
                    filterAndSortFiles();
                });

                function filterAndSortFiles() {
                    const searchTerm = searchInput.value.toLowerCase();
                    const sortBy = sortSelect.value; // e.g., 'name-asc', 'uploaded-desc'

                    let items = Array.from(document.querySelectorAll('.file-item'));

                    // Filter
                    items.forEach(item => {
                        const itemName = item.dataset.name.toLowerCase();
                        item.style.display = itemName.includes(searchTerm) ? '' : 'none';
                    });

                    // Sort visible items
                    const visibleItems = items.filter(item => item.style.display !== 'none');

                    visibleItems.sort((a, b) => {
                        const nameA = a.dataset.name.toLowerCase();
                        const nameB = b.dataset.name.toLowerCase();
                        const typeA = a.dataset.type;
                        const typeB = b.dataset.type;

                        // Always keep folders at the top
                        if (typeA === 'folder' && typeB !== 'folder') return -1;
                        if (typeA !== 'folder' && typeB === 'folder') return 1;

                        if (sortBy.startsWith('name')) {
                            return sortBy === 'name-asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
                        } else if (sortBy.startsWith('uploaded') && typeA !== 'folder') {
                            const dateA = new Date(a.dataset.uploaded || 0); // Use 0 for N/A or older
                            const dateB = new Date(b.dataset.uploaded || 0);
                            return sortBy === 'uploaded-desc' ? dateB - dateA : dateA - dateB;
                        } else if (sortBy.startsWith('size') && typeA !== 'folder') {
                             // Parse byte string like "100 KB"
                            const sizeA = parseSizeToBytes(a.dataset.size || '0 Bytes');
                            const sizeB = parseSizeToBytes(b.dataset.size || '0 Bytes');
                            return sortBy === 'size-desc' ? sizeB - sizeA : sizeA - sizeB;
                        }
                        return 0; // Default no change
                    });

                    // Re-append sorted items to their respective containers
                    const targetContainer = currentView === 'list' ? listView.querySelector('tbody') : gridView;
                    visibleItems.forEach(item => targetContainer.appendChild(item));
                }

                 function parseSizeToBytes(sizeString) {
                    const parts = sizeString.split(' ');
                    const value = parseFloat(parts[0]);
                    const unit = parts[1];
                    switch (unit) {
                        case 'KB': return value * 1024;
                        case 'MB': return value * 1024 * 1024;
                        case 'GB': return value * 1024 * 1024 * 1024;
                        case 'TB': return value * 1024 * 1024 * 1024 * 1024;
                        default: return value; // Assume Bytes
                    }
                }

                // Toggle View
                toggleViewButton.addEventListener('click', toggleView);

                function toggleView() {
                    if (currentView === 'list') {
                        listView.classList.add('hidden');
                        gridView.classList.remove('hidden');
                        viewIcon.classList.remove('fa-th-large');
                        viewIcon.classList.add('fa-list');
                        viewText.textContent = 'List View';
                        currentView = 'grid';
                        localStorage.setItem('fileView', 'grid');
                    } else {
                        gridView.classList.add('hidden');
                        listView.classList.remove('hidden');
                        viewIcon.classList.remove('fa-list');
                        viewIcon.classList.add('fa-th-large');
                        viewText.textContent = 'Grid View';
                        currentView = 'list';
                        localStorage.setItem('fileView', 'list');
                    }
                    filterAndSortFiles(); // Re-apply filters/sort after view change
                }

                // --- Context Menu ---
                const contextMenu = document.getElementById('context-menu');
                const contextOpen = document.getElementById('context-open');
                const contextPreview = document.getElementById('context-preview');
                const contextDownload = document.getElementById('context-download');
                const contextEdit = document.getElementById('context-edit');
                const contextRename = document.getElementById('context-rename');
                const contextCopy = document.getElementById('context-copy');
                const contextShare = document.getElementById('context-share');
                const contextDelete = document.getElementById('context-delete');

                // Hide context menu on left-click anywhere
                document.addEventListener('click', (e) => {
                    if (!contextMenu.contains(e.target)) {
                        contextMenu.classList.add('hidden');
                    }
                });

                // Show context menu on right-click on file/folder items
                fileItems.forEach(item => {
                    item.addEventListener('contextmenu', (e) => {
                        e.preventDefault(); // Prevent default browser context menu

                        currentItemPath = item.dataset.itemPath;
                        currentItemName = item.dataset.name;
                        isCurrentItemFolder = item.dataset.isFolder === 'true';

                        // Position the context menu
                        contextMenu.style.left = `${e.pageX}px`;
                        contextMenu.style.top = `${e.pageY}px`;
                        contextMenu.classList.remove('hidden');

                        // Show/hide options based on item type
                        contextOpen.style.display = isCurrentItemFolder ? 'flex' : 'none';
                        contextPreview.style.display = isCurrentItemFolder ? 'none' : 'flex';
                        contextDownload.style.display = isCurrentItemFolder ? 'none' : 'flex';
                        contextEdit.style.display = isCurrentItemFolder || (item.dataset.type !== 'text' && item.dataset.type !== 'code') ? 'none' : 'flex';
                        contextShare.style.display = isCurrentItemFolder ? 'none' : 'flex'; // Can extend share to folders too
                    });
                });

                // Context Menu Actions
                contextOpen.addEventListener('click', () => {
                    if (isCurrentItemFolder) window.location.href = `/?path=${encodeURIComponent(currentItemPath)}`;
                    contextMenu.classList.add('hidden');
                });
                contextPreview.addEventListener('click', () => {
                    if (!isCurrentItemFolder) window.open(`/preview/${encodeURIComponent(currentItemPath)}`, '_blank');
                    contextMenu.classList.add('hidden');
                });
                contextDownload.addEventListener('click', () => {
                    if (!isCurrentItemFolder) window.location.href = `/download/${encodeURIComponent(currentItemPath)}`;
                    contextMenu.classList.add('hidden');
                });
                contextEdit.addEventListener('click', () => {
                    if (!isCurrentItemFolder) window.location.href = `/edit/${encodeURIComponent(currentItemPath)}`;
                    contextMenu.classList.add('hidden');
                });
                contextRename.addEventListener('click', () => {
                    showRenameModal(currentItemPath, currentItemName, isCurrentItemFolder);
                    contextMenu.classList.add('hidden');
                });
                contextCopy.addEventListener('click', () => {
                    showCopyModal(currentItemPath, currentItemName, isCurrentItemFolder, currentDirectoryPath);
                    contextMenu.classList.add('hidden');
                });
                contextShare.addEventListener('click', () => {
                    if (!isCurrentItemFolder) window.location.href = `/share/${encodeURIComponent(currentItemPath)}`;
                    contextMenu.classList.add('hidden');
                });
                contextDelete.addEventListener('click', () => {
                    if (confirm('Are you absolutely sure you want to delete this item? This cannot be undone.')) {
                        window.location.href = `/delete/${encodeURIComponent(currentItemPath)}`;
                    }
                    contextMenu.classList.add('hidden');
                });

                // Close modals when clicking outside or pressing Escape
                document.querySelectorAll('.modal-overlay').forEach(overlay => {
                    overlay.addEventListener('click', (e) => {
                        if (e.target === overlay) {
                            hideCreateFolderModal();
                            hideRenameModal();
                            hideCopyModal();
                        }
                    });
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        hideCreateFolderModal();
                        hideRenameModal();
                        hideCopyModal();
                    }
                });

                 // Initial filter and sort application
                filterAndSortFiles();
            });
        </script>
    </body>
    </html>
    `;
}

function renderCreateFolderModal() {
    return `
    <div id="create-folder-modal" class="modal-overlay hidden fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
        <div class="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
            <h2 class="text-2xl font-bold mb-4 text-gray-800 flex items-center"><i class="fas fa-folder-plus mr-3 text-green-500"></i> Create New Folder</h2>
            <form action="/create-folder" method="POST">
                <input type="hidden" name="currentPath" id="create-folder-path" value="">
                <div class="mb-4">
                    <label for="new-folder-name" class="block text-gray-700 text-sm font-bold mb-2">Folder Name:</label>
                    <input type="text" id="new-folder-name" name="folderName"
                           class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                           placeholder="Enter folder name" required>
                </div>
                <div class="flex justify-end space-x-4">
                    <button type="button" onclick="hideCreateFolderModal()" class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition-colors duration-200">Cancel</button>
                    <button type="submit" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors duration-200">Create Folder</button>
                </div>
            </form>
        </div>
    </div>
    `;
}

function renderRenameModal() {
    return `
    <div id="rename-modal" class="modal-overlay hidden fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
        <div class="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
            <h2 class="text-2xl font-bold mb-4 text-gray-800 flex items-center"><i class="fas fa-i-cursor mr-3 text-yellow-500"></i> Rename Item</h2>
            <form id="rename-form" method="POST">
                <p class="text-gray-600 mb-4">Renaming: <span id="rename-old-name" class="font-semibold"></span></p>
                <div class="mb-4">
                    <label for="new-item-name" class="block text-gray-700 text-sm font-bold mb-2">New Name:</label>
                    <input type="text" id="new-item-name" name="newName"
                           class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                           placeholder="Enter new name" required>
                </div>
                <div class="flex justify-end space-x-4">
                    <button type="button" onclick="hideRenameModal()" class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition-colors duration-200">Cancel</button>
                    <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors duration-200">Rename</button>
                </div>
            </form>
        </div>
    </div>
    <script>
        document.getElementById('rename-form').addEventListener('submit', function(e) {
            e.preventDefault();
            const form = e.target;
            const newName = document.getElementById('new-item-name').value;
            const actionUrl = \`/rename/\${encodeURIComponent(currentItemPath)}\`;
            fetch(actionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newName: newName })
            })
            .then(response => {
                if (response.ok) {
                    window.location.reload();
                } else {
                    response.text().then(text => alert('Rename failed: ' + text));
                }
            })
            .catch(error => alert('Network error: ' + error.message));
        });
    </script>
    `;
}

function renderCopyModal() {
    return `
    <div id="copy-modal" class="modal-overlay hidden fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
        <div class="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
            <h2 class="text-2xl font-bold mb-4 text-gray-800 flex items-center"><i class="fas fa-copy mr-3 text-purple-500"></i> Copy Item</h2>
            <form id="copy-form" method="POST">
                <p class="text-gray-600 mb-4">Copying: <span id="copy-item-name" class="font-semibold"></span></p>
                <div class="mb-4">
                    <label for="copy-destination-path" class="block text-gray-700 text-sm font-bold mb-2">Destination Folder (relative to root):</label>
                    <input type="text" id="copy-destination-path" name="destinationPath"
                           class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                           placeholder="/path/to/destination" required>
                </div>
                <div class="flex justify-end space-x-4">
                    <button type="button" onclick="hideCopyModal()" class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition-colors duration-200">Cancel</button>
                    <button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded transition-colors duration-200">Copy</button>
                </div>
            </form>
        </div>
    </div>
    <script>
        document.getElementById('copy-form').addEventListener('submit', function(e) {
            e.preventDefault();
            const form = e.target;
            const destinationPath = document.getElementById('copy-destination-path').value;
            const actionUrl = \`/copy/\${encodeURIComponent(currentItemPath)}\`;
            fetch(actionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ destinationPath: destinationPath })
            })
            .then(response => {
                if (response.ok) {
                    window.location.reload();
                } else {
                    response.text().then(text => alert('Copy failed: ' + text));
                }
            })
            .catch(error => alert('Network error: ' + error.message));
        });
    </script>
    `;
}


function renderImagePreview(filepath, originalName) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Image Preview: ${escapeHtml(originalName)}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-100 flex flex-col min-h-screen">
        <div class="container mx-auto px-4 py-8 flex-grow">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="fas fa-image text-blue-500 mr-2"></i>
                    ${escapeHtml(originalName)}
                </h1>
                <div class="flex space-x-3">
                    <a href="/download/${encodeURIComponent(filepath)}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-download mr-1"></i> Download
                    </a>
                    <a href="/?path=${encodeURIComponent(path.dirname(filepath))}" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-arrow-left mr-1"></i> Back
                    </a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-lg p-6 flex justify-center items-center overflow-hidden" style="min-height: 70vh;">
                <img src="/download/${encodeURIComponent(filepath)}" alt="${escapeHtml(originalName)}" class="max-w-full max-h-full object-contain border border-gray-200 rounded-lg">
            </div>
        </div>
    </body>
    </html>
    `;
}

function renderPDFPreview(filepath, originalName) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PDF Preview: ${escapeHtml(originalName)}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-100 flex flex-col min-h-screen">
        <div class="container mx-auto px-4 py-8 flex-grow">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="fas fa-file-pdf text-red-500 mr-2"></i>
                    ${escapeHtml(originalName)}
                </h1>
                <div class="flex space-x-3">
                    <a href="/download/${encodeURIComponent(filepath)}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-download mr-1"></i> Download
                    </a>
                    <a href="/?path=${encodeURIComponent(path.dirname(filepath))}" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-arrow-left mr-1"></i> Back
                    </a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-lg overflow-hidden" style="min-height: 80vh;">
                <iframe
                    src="/download/${encodeURIComponent(filepath)}"
                    class="w-full h-full border-none"
                    title="PDF Viewer for ${escapeHtml(originalName)}"
                ></iframe>
            </div>
        </div>
    </body>
    </html>
    `;
}

function renderTextViewer(filepath, originalName, content) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Text Viewer: ${escapeHtml(originalName)}</title>
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
                    ${escapeHtml(originalName)}
                </h1>
                <div class="flex space-x-3">
                    <a href="/download/${encodeURIComponent(filepath)}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-download mr-1"></i> Download
                    </a>
                    <a href="/edit/${encodeURIComponent(filepath)}" class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-edit mr-1"></i> Edit
                    </a>
                    <a href="/?path=${encodeURIComponent(path.dirname(filepath))}" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
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

function renderAudioPlayer(filepath, originalName) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Audio Player: ${escapeHtml(originalName)}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-100 flex flex-col min-h-screen">
        <div class="container mx-auto px-4 py-8 flex-grow">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="fas fa-file-audio text-green-500 mr-2"></i>
                    ${escapeHtml(originalName)}
                </h1>
                <div class="flex space-x-3">
                    <a href="/download/${encodeURIComponent(filepath)}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-download mr-1"></i> Download
                    </a>
                    <a href="/?path=${encodeURIComponent(path.dirname(filepath))}" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-arrow-left mr-1"></i> Back
                    </a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-lg p-8 flex flex-col items-center justify-center">
                <i class="fas fa-music text-6xl text-gray-400 mb-6"></i>
                <p class="text-xl font-medium text-gray-700 mb-4">${escapeHtml(originalName)}</p>
                <audio controls class="w-full max-w-lg">
                    <source src="/download/${encodeURIComponent(filepath)}" type="audio/${path.extname(filepath).slice(1)}">
                    Your browser does not support the audio element.
                </audio>
            </div>
        </div>
    </body>
    </html>
    `;
}

function renderVideoPlayer(filepath, originalName) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Video Player: ${escapeHtml(originalName)}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-100 flex flex-col min-h-screen">
        <div class="container mx-auto px-4 py-8 flex-grow">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="fas fa-file-video text-purple-500 mr-2"></i>
                    ${escapeHtml(originalName)}
                </h1>
                <div class="flex space-x-3">
                    <a href="/download/${encodeURIComponent(filepath)}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-download mr-1"></i> Download
                    </a>
                    <a href="/?path=${encodeURIComponent(path.dirname(filepath))}" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-arrow-left mr-1"></i> Back
                    </a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-lg p-6 flex flex-col items-center justify-center">
                <p class="text-xl font-medium text-gray-700 mb-4">${escapeHtml(originalName)}</p>
                <video controls class="w-full max-w-3xl border border-gray-200 rounded-lg">
                    <source src="/download/${encodeURIComponent(filepath)}" type="video/${path.extname(filepath).slice(1)}">
                    Your browser does not support the video element.
                </video>
            </div>
        </div>
    </body>
    </html>
    `;
}

function renderFileEditor(filepath, originalName, content) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Edit File: ${escapeHtml(originalName)}</title>
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
                    Editing: ${escapeHtml(originalName)}
                </h1>
                <div class="flex space-x-3">
                    <a href="/preview/${encodeURIComponent(filepath)}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-eye mr-1"></i> Preview
                    </a>
                    <a href="/?path=${encodeURIComponent(path.dirname(filepath))}" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-arrow-left mr-1"></i> Back to Dashboard
                    </a>
                </div>
            </div>

            <form action="/save/${encodeURIComponent(filepath)}" method="POST" class="bg-white rounded-xl shadow-lg p-6">
                <textarea
                    name="content"
                    rows="25"
                    class="w-full p-4 font-mono text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50 text-gray-800"
                    spellcheck="false"
                >${escapeHtml(content)}</textarea>
                <div class="mt-6 flex justify-end space-x-4">
                    <a href="/preview/${encodeURIComponent(filepath)}" class="bg-gray-500 hover:bg-gray-600 text-white px-5 py-2 rounded-lg font-semibold transition-colors duration-200">
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

function renderDefaultPreview(filepath, originalName, size, fileType) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>File Info: ${escapeHtml(originalName)}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-100 flex flex-col min-h-screen">
        <div class="container mx-auto px-4 py-8 flex-grow">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="${getFileIcon(fileType)} text-blue-500 mr-2"></i>
                    ${escapeHtml(originalName)}
                </h1>
                <div class="flex space-x-3">
                    <a href="/download/${encodeURIComponent(filepath)}" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-download mr-1"></i> Download
                    </a>
                    <a href="/?path=${encodeURIComponent(path.dirname(filepath))}" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                        <i class="fas fa-arrow-left mr-1"></i> Back
                    </a>
                </div>
            </div>

            <div class="bg-white rounded-xl shadow-lg p-8 text-center">
                <i class="${getFileIcon(fileType)} text-7xl text-gray-400 mb-6"></i>
                <h2 class="text-2xl font-medium text-gray-800 mb-3">${escapeHtml(originalName)}</h2>
                <p class="text-gray-600 mb-6">${formatBytes(size)} • ${path.extname(filepath).toUpperCase().slice(1) || 'Unknown Type'}</p>
                <p class="text-gray-500 text-lg">
                    Preview is not available for this file type. You can download it to view.
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
}

function renderShareLink(originalName, shareableLink) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Share File: ${escapeHtml(originalName)}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-100 flex flex-col min-h-screen">
        <div class="container mx-auto px-4 py-8 flex-grow">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-800">
                    <i class="fas fa-share-alt text-purple-500 mr-2"></i>
                    Share: ${escapeHtml(originalName)}
                </h1>
                <a href="/" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-lg flex items-center transition-colors duration-200">
                    <i class="fas fa-arrow-left mr-1"></i> Back to Dashboard
                </a>
            </div>

            <div class="bg-white rounded-xl shadow-lg p-8 text-center">
                <p class="text-gray-700 text-lg mb-4">
                    Share this link to allow others to download <strong>${escapeHtml(originalName)}</strong>:
                </p>
                <div class="flex items-center justify-center space-x-3 mb-6">
                    <input type="text" id="shareLink" value="${escapeHtml(shareableLink)}" readonly
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
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Path</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User Agent</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${fileHistory.length > 0 ? fileHistory.map(entry => `
                        <tr class="hover:bg-gray-50 transition-colors duration-100">
                            <td class="px-6 py-4 whitespace-nowrap">
                                <span class="px-3 py-1 inline-flex items-center text-xs font-semibold rounded-full ${
                                    entry.action.startsWith('upload') ? 'bg-green-100 text-green-800' :
                                    entry.action.startsWith('download') ? 'bg-blue-100 text-blue-800' :
                                    entry.action.startsWith('edit') ? 'bg-yellow-100 text-yellow-800' :
                                    entry.action.startsWith('delete') ? 'bg-red-100 text-red-800' :
                                    'bg-gray-100 text-gray-800'
                                }">
                                    <i class="fas ${
                                        entry.action.startsWith('upload') ? 'fa-upload' :
                                        entry.action.startsWith('download') ? 'fa-download' :
                                        entry.action.startsWith('edit') ? 'fa-edit' :
                                        entry.action.startsWith('delete') ? 'fa-trash' :
                                        entry.action.startsWith('create_folder') ? 'fa-folder-plus' :
                                        entry.action.startsWith('rename') ? 'fa-i-cursor' :
                                        entry.action.startsWith('copy') ? 'fa-copy' :
                                        entry.action.startsWith('share') ? 'fa-share-alt' :
                                        'fa-info-circle'
                                    } mr-1"></i>
                                    ${escapeHtml(entry.action.replace(/_/g, ' ').charAt(0).toUpperCase() + entry.action.slice(1))}
                                </span>
                            </td>
                            <td class="px-6 py-4 text-gray-800 truncate" style="max-width: 200px;">${escapeHtml(entry.filename)}</td>
                            <td class="px-6 py-4 text-gray-700 truncate" style="max-width: 150px;">${escapeHtml(entry.currentPath)}</td>
                            <td class="px-6 py-4 text-gray-700">${new Date(entry.timestamp).toLocaleString()}</td>
                            <td class="px-6 py-4 text-gray-700">${escapeHtml(entry.ip)}</td>
                            <td class="px-6 py-4 text-gray-700 text-sm truncate" style="max-width: 250px;">${escapeHtml(entry.userAgent)}</td>
                        </tr>
                        `).join('') : `
                        <tr>
                            <td colspan="6" class="px-6 py-12 text-center text-gray-500">
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
    const popularFiles = files.filter(f => typeof f.downloads === 'number').sort((a, b) => b.downloads - a.downloads).slice(0, 5);
    const fileTypes = files.reduce((acc, file) => {
        acc[file.type] = (acc[file.type] || 0) + 1;
        return acc;
    }, {});
    const fileTypeBreakdown = Object.entries(fileTypes).map(([type, count]) => `
        <li class="flex justify-between items-center text-gray-700">
            <span><i class="${getFileIcon(type)} mr-2 text-blue-500"></i> ${escapeHtml(type.charAt(0).toUpperCase() + type.slice(1))}</span>
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
                        <li class="flex justify-between"><span>Total Files Tracked:</span> <span class="font-medium">${systemInfo.totalFiles}</span></li>
                        <li class="flex justify-between"><span>Total Storage Used (Tracked):</span> <span class="font-medium">${systemInfo.totalStorageUsed}</span></li>
                        <li class="flex justify-between"><span>Active Connections:</span> <span class="font-medium">${systemInfo.activeConnections}</span></li>
                        <li class="flex justify-between"><span>Max File Size Allowed:</span> <span class="font-medium">${systemInfo.maxFileSize}</span></li>
                        <li class="flex justify-between"><span>Max Files per Upload:</span> <span class="font-medium">${systemInfo.maxFilesPerUpload}</span></li>
                        <li class="flex justify-between"><span>Allowed File Types:</span> <span class="font-medium text-sm">${escapeHtml(systemInfo.allowedFileTypes)}</span></li>
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
                                <span class="truncate" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
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
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Path</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${recentHistory.length > 0 ? recentHistory.map(entry => `
                                <tr class="hover:bg-gray-50">
                                    <td class="px-6 py-4 whitespace-nowrap">
                                        <span class="px-3 py-1 inline-flex items-center text-xs font-semibold rounded-full ${
                                            entry.action.startsWith('upload') ? 'bg-green-100 text-green-800' :
                                            entry.action.startsWith('download') ? 'bg-blue-100 text-blue-800' :
                                            entry.action.startsWith('edit') ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-red-100 text-red-800'
                                        }">
                                            <i class="fas ${
                                                entry.action.startsWith('upload') ? 'fa-upload' :
                                                entry.action.startsWith('download') ? 'fa-download' :
                                                entry.action.startsWith('edit') ? 'fa-edit' :
                                                entry.action.startsWith('delete') ? 'fa-trash' :
                                                entry.action.startsWith('create_folder') ? 'fa-folder-plus' :
                                                entry.action.startsWith('rename') ? 'fa-i-cursor' :
                                                entry.action.startsWith('copy') ? 'fa-copy' :
                                                entry.action.startsWith('share') ? 'fa-share-alt' :
                                                'fa-info-circle'
                                            } mr-1"></i>
                                            ${escapeHtml(entry.action.replace(/_/g, ' ').charAt(0).toUpperCase() + entry.action.slice(1))}
                                        </span>
                                    </td>
                                    <td class="px-6 py-4 text-gray-800 truncate" style="max-width: 200px;">${escapeHtml(entry.filename)}</td>
                                    <td class="px-6 py-4 text-gray-700 truncate" style="max-width: 150px;">${escapeHtml(entry.currentPath)}</td>
                                    <td class="px-6 py-4 text-gray-700">${new Date(entry.timestamp).toLocaleString()}</td>
                                    <td class="px-6 py-4 text-gray-700">${escapeHtml(entry.ip)}</td>
                                </tr>
                            `).join('') : `
                                <tr>
                                    <td colspan="5" class="px-6 py-12 text-center text-gray-500">No recent activity.</td>
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

// Graceful shutdown: Save persistent data on exit
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    savePersistentData(); // Save data before exiting
    server.close(() => {
        console.log('HTTP server closed. Data saved.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    savePersistentData(); // Save data before exiting
    server.close(() => {
        console.log('HTTP server closed. Data saved.');
        process.exit(0);
    });
});
