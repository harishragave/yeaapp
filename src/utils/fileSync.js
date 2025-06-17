// src/utils/fileSync.js
const fs = require('fs-extra');
const path = require('path');
const { ipcRenderer } = require('electron');

class FileSyncManager {
  constructor() {
    this.screenshotsRoot = path.join(__dirname, '..', 'public', 'screenshots');
    this.isProcessing = false;
  }

  async getAllJsonFiles(dir = this.screenshotsRoot) {
    let results = [];
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      
      for (const file of files) {
        const filePath = path.join(dir, file.name);
        
        if (file.isDirectory()) {
          const subFiles = await this.getAllJsonFiles(filePath);
          results = results.concat(subFiles);
        } else if (file.name.endsWith('.json')) {
          results.push(filePath);
        }
      }
    } catch (error) {
      console.error('Error reading directory:', error);
    }
    return results;
  }

  async processFiles() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const files = await this.getAllJsonFiles();
      console.log(`Found ${files.length} JSON files to process`);

      for (const filePath of files) {
        try {
          const fileData = await fs.readJson(filePath);
          const success = await window.electronAPI.uploadScreenshot({ filePath, data: fileData });
          
          if (success) {
            await fs.unlink(filePath);
            console.log(`Processed and deleted: ${filePath}`);
          }
        } catch (error) {
          console.error(`Error processing ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in processFiles:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}

module.exports = new FileSyncManager();