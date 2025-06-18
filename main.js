const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { desktopCapturer, screen } = electron;
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
// Verify Electron app is loaded
if (!app) {
    console.error('Failed to load Electron app module. Make sure Electron is installed correctly.');
    process.exit(1);
}

let mainWindow;
let isTracking = false;
let trackingInterval;
let lastMousePosition = { x: 0, y: 0 };
const MOUSE_MOVE_THROTTLE_MS = 100; // Adjust this value (100ms default)
let lastMouseEventSent = 0;
let mouseClickCount = 0;
let keyboardPressCount = 0;

// Set screenshot interval to 10 minutes (600,000 ms)
const SCREENSHOT_INTERVAL = 2 * 60 * 1000;
let currentProjectID = null;
let currentUserID = null;
let currentTaskID = null;
// let currentProjectName = null;
// let currentTaskName = null;

// Remove the original saveToWorkdiary function and replace with:
async function saveToWorkdiary(data) {
    try {
        console.log('Saving to workdiary, thumbnailURL exists:', !!data.thumbnailURL);
        console.log('Data being sent to server:', {
            projectID: data.projectID,
            userID: data.userID,
            taskID: data.taskID,
            screenshotTimeStamp: data.screenshotTimeStamp,
            calcTimeStamp: data.calcTimeStamp,
            keyboardJSON: data.keyboardJSON,
            mouseJSON: data.mouseJSON,
            activeFlag: 1,
            deletedFlag: 0,
            imageURL: data.imageURL.substring(0, 50) + '...',  // Show first 50 chars for debugging
            thumbnailURL: data.thumbnailURL.substring(0, 50) + '...'  // Show first 50 chars for debugging
        });

        const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectID: data.projectID,
                userID: data.userID,
                taskID: data.taskID,
                screenshotTimeStamp: data.screenshotTimeStamp,
                calcTimeStamp: data.calcTimeStamp,
                keyboardJSON: data.keyboardJSON,
                mouseJSON: data.mouseJSON,
                activeJSON: data.activeJSON || {},
                activeFlag: 1,
                activeMins: 1,
                deletedFlag: 0,
                activeMemo: '',
                imageURL: data.imageURL,
                thumbNailURL: data.thumbnailURL
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server responded with error, trying local save...', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        console.log('Data saved via backend API');
        return {
            success: true,
            savedLocally: false,
            data: await response.json()
        };
    } catch (error) {
        console.error('API request failed, trying local save...', error);
        try {
            const localResult = await saveScreenshotLocally(data);
            return {
                ...localResult,
                serverError: error.message
            };
        } catch (localError) {
            console.error('Both server and local save failed:', localError);
            return {
                success: false,
                savedLocally: false,
                error: `Server: ${error.message}, Local: ${localError.message}`
            };
        }
    }
}
async function processScreenshotFiles() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

    try {
        const files = await getJsonFilesRecursively(screenshotsDir);
        console.log('All files:', files);

        for (const filePath of files) {
            try {
                const fileContent = await fs.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(fileContent);
                // Get the task data file path from the task directory
                const taskDataPath = path.join(
                    screenshotsDir,
                    `project_${jsonData.projectID}`,
                    `task_${jsonData.taskID}`,
                    `taskData_${jsonData.taskID}.json`
                );
                // Read task data
                // let taskData = {};
                try {
                    const taskDataContent = await fs.readFile(taskDataPath, 'utf8');
                    taskData = JSON.parse(taskDataContent);
                } catch (error) {
                    console.warn('Task data file not found or unreadable:', taskDataPath);
                }

                // Fixed data mapping - use activeJSON instead of activeFlag
                const dataToSend = {
                    projectID: jsonData.projectID,
                    userID: jsonData.userID,
                    taskID: jsonData.taskID,
                    screenshotTimeStamp: jsonData.screenshotTimeStamp,
                    calcTimeStamp: jsonData.calcTimeStamp,
                    keyboardJSON: jsonData.keyboardJSON,
                    mouseJSON: jsonData.mouseJSON,
                    activeJSON: jsonData.activeJSON || {},
                    activeFlag: jsonData.activeFlag !== undefined ? jsonData.activeFlag : 1,
                    activeMins: jsonData.activeMins !== undefined ? jsonData.activeMins : 1,
                    deletedFlag: jsonData.deletedFlag !== undefined ? jsonData.deletedFlag : 0,
                    activeMemo: jsonData.activeMemo || 'google',
                    imageURL: jsonData.imageURL || '',
                    thumbNailURL: jsonData.thumbNailURL || '',
                    createdAt: jsonData.createdAt || new Date().toISOString(),
                    modifiedAt: jsonData.modifiedAT || jsonData.modifiedAt || new Date().toISOString()
                };
                console.log('Data being sent to server:', dataToSend);
                try {
                    const response = await fetch(
                        'https://vw.aisrv.in/node_backend/postProjectV1',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(dataToSend),
                            timeout: 10000
                        }
                    );

                    if (response.status === 200) {
                        // Delete the file after successful upload
                        await fs.unlink(filePath);
                        console.log(`Processed and deleted: ${filePath}`);
                    }

                    console.log(`✅ Successfully processed ${filePath}`);
                } catch (error) {
                    console.error(`❌ Error processing ${filePath}:`, error.message);
                    if (error.response) {
                        console.error('Server error details:', error.response.data);
                    }
                }
            } catch (error) {
                console.error('Error in processScreenshotFiles:', error);
            }
        }
    } catch (error) {
        console.error('Error in processScreenshotFiles:', error);
    }
}
async function initScreenshotWatcher() {
    const screenshotsDir = path.join(__dirname, 'public', 'screenshots');

    try {
        await fs.mkdir(screenshotsDir, { recursive: true });

        // Process existing files first
        console.log('Processing existing files...');
        await processScreenshotFiles();
        console.log('✅ Successfully processed existing files');
        // Set up file watcher
        const chokidar = require('chokidar');
        const watcher = chokidar.watch(screenshotsDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100
            }
        });

        watcher.on('add', async (filePath) => {
            if (filePath.endsWith('.json') && path.basename(filePath).startsWith('screenshot_')) {
                console.log('New file added:', filePath);
                await processScreenshotFiles();
            }
        });

        watcher.on('error', error => {
            console.error('Watcher error:', error);
        });

    } catch (error) {
        console.error('Error setting up file watcher:', error);
    }
}
async function getJsonFilesRecursively(dir) {
    let results = [];
    try {
        const files = await fs.readdir(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                results = [...results, ...await getJsonFilesRecursively(fullPath)];
            } else if (file.name.endsWith('.json') && file.name.startsWith('screenshot_')) {
                // Include files that are in date-based di
                const parentDir = path.basename(path.dirname(fullPath));
                if (/^\d{4}-\d{2}-\d{2}$/.test(parentDir)) { // Matches YYYY-MM-DD format
                    results.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }
    console.log('results:', results);
    return results;
}
// function getHourlyFolderName() {
//     const now = new Date();
//     const hour = now.getHours();
//     // Format as "10-11" for 10:00-10:59
//     return `${String(hour).padStart(2, '0')}-${String(hour + 1).padStart(2, '0')}`;
// }

async function saveScreenshotLocally(data) {
    try {
        const baseFolder = path.join(__dirname, 'public', 'screenshots');
        const datePath = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const screenshotFolder = path.join(baseFolder, `project_${data.projectID}`, `task_${data.taskID}`, datePath);
        await fs.ensureDir(screenshotFolder);

        // Define filenames
        const timestamp = Date.now();
        const jsonFilename = `screenshot_${timestamp}.json`;
        

        // Log the actual base64 prefixes for debugging
        console.log("Debug: imageURL prefix:", data.imageURL?.substring(0, 50));
        console.log("Debug: thumbnailURL prefix:", data.thumbNailURL?.substring(0, 50));

        // Validate base64 format
        const screenshotMatch = data.imageURL?.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
        const thumbnailMatch = data.thumbNailURL?.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);

        if (!screenshotMatch || !thumbnailMatch) {
            console.log("🧪 imageURL prefix:", data.imageURL?.substring(0, 50));
            console.log("🧪 thumbnailURL prefix:", data.thumbNailURL?.substring(0, 50));
            console.error("❌ Invalid base64 image format");
            return { success: false, error: "Invalid base64 image format" };
        }

        // Decode and write screenshot image
       
        // Write JSON metadata
        const metadata = {
            projectID: data.projectID,
            userID: data.userID,
            taskID: data.taskID,
            screenshotTimeStamp: new Date().toISOString(),
            calcTimeStamp: new Date().toISOString(),
            keyboardJSON: { clicks: data.keyboardJSON },
            mouseJSON: { clicks: data.mouseJSON },
            activeJSON: { app: data.activeJSON || 'Unknown' },
            activeFlag: 1,
            activeMins: 1, // default or calculated
            deletedFlag: 0,
            activeMemo: '',
            imageURL: data.imageURL,  // Store the actual base64 data
            thumbNailURL: data.thumbNailURL,  // Store the actual base64 data
            createdAt: new Date().toISOString(),
            modifiedAT: new Date().toISOString()
        };

        await fs.writeJson(path.join(screenshotFolder, jsonFilename), metadata, { spaces: 2 });
        console.log(`✅ Saved screenshot: ${jsonFilename}`);
        return {
            success: true,
            savedLocally: true,
            filePath: path.join(screenshotFolder, jsonFilename)
        };
    } catch (error) {
        console.error('Error saving screenshot locally:', error);
        throw error;
    }
}


async function takeScreenshot(mouseClickCount, keyboardPressCount) {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: screen.getPrimaryDisplay().workAreaSize
        });

        // Generate full-size screenshot with base64 prefix
        const fullSizeBase64 = `data:image/png;base64,${sources[0].thumbnail.resize({
            width: 1200,
            height: 800,
            quality: 'good'
        }).toJPEG(60).toString('base64')}`;

        // Generate thumbnail with base64 prefix
        const thumbnailBase64 = `data:image/png;base64,${sources[0].thumbnail.resize({
            width: 300,
            height: 200,
            quality: 'good'
        }).toJPEG(60).toString('base64')}`;

        // Log the first 50 characters of the base64 strings for debugging
        console.log('Debug: Full image base64 prefix:', fullSizeBase64.substring(0, 50));
        console.log('Debug: Thumbnail base64 prefix:', thumbnailBase64.substring(0, 50));

        const workdiaryData = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            screenshotTimeStamp: new Date(),
            calcTimeStamp: new Date(),
            keyboardJSON: JSON.stringify({ clicks: keyboardPressCount }),
            mouseJSON: JSON.stringify({ clicks: mouseClickCount }),
            imageURL: fullSizeBase64,
            thumbNailURL: thumbnailBase64,
            activeFlag: 1,
            deletedFlag: 0,
            activeMemo: 'google',
            createdAt: new Date(),
            modifiedAT: new Date()
        };

        console.log('Screenshot data size:',
            JSON.stringify(workdiaryData).length / 1024, 'KB');

        // Try to save to server first, it will fall back to local if needed
        const result = await saveToWorkdiary(workdiaryData);

        if (result && result.success) {
            // Reset the counters after successful save
            const resetInfo = {
                mouseClicks: mouseClickCount,
                keyPresses: keyboardPressCount
            };

            // Reset the global counters
            mouseClickCount = 0;
            keyboardPressCount = 0;

            return {
                ...result,
                resetInfo,
                countersReset: true
            };
        }

        return result;
    } catch (error) {
        console.error('Error in takeScreenshot:', error);
        return {
            success: false,
            error: error.message,
            savedLocally: false
        };
    }
}

function sendGlobalEvent(event) {
    if (!event.type) {
        console.error('Attempted to send event without type:', event);
        return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('global-event', event);
    }
}

function startTracking() {
    if (isTracking) return;
    isTracking = true;

    uIOhook.start();
    const firstDelay = Math.floor(Math.random() * SCREENSHOT_INTERVAL);
    console.log(`🕓 First screenshot will be taken in ${Math.floor(firstDelay / 1000)} seconds`);

    setTimeout(() => {
        if (typeof mouseClickCount !== 'undefined' && typeof keyboardPressCount !== 'undefined') {
            takeScreenshot(mouseClickCount, keyboardPressCount);
        }
    }, firstDelay);
    // Set up the recurring interval every 10 minutes
    trackingInterval = setInterval(() => {
        const randomDelay = Math.floor(Math.random() * SCREENSHOT_INTERVAL);

        console.log(`🕓 Next screenshot will be taken in ${Math.floor(randomDelay / 1000)} seconds`);

        setTimeout(() => {
            if (typeof mouseClickCount !== 'undefined' && typeof keyboardPressCount !== 'undefined') {
                takeScreenshot(mouseClickCount, keyboardPressCount);
            }
        }, randomDelay);
    }, SCREENSHOT_INTERVAL);

    // Mouse move event
    uIOhook.on('mousemove', (event) => {
        const now = Date.now();

        // Throttle mouse move events
        if (now - lastMouseEventSent >= MOUSE_MOVE_THROTTLE_MS) {
            lastMouseEventSent = now;
            lastMousePosition = { x: event.x, y: event.y };
            sendGlobalEvent({
                type: 'mousemove',
                x: event.x,
                y: event.y
            });
        }
    });

    // Mouse click event
    uIOhook.on('click', (event) => {
        mouseClickCount++;
        sendGlobalEvent({
            type: 'mouseclick',
            button: event.button,
            x: event.x,
            y: event.y
        });
    });

    // Key press event
    uIOhook.on('keydown', (event) => {
        keyboardPressCount++;
        sendGlobalEvent({
            type: 'keydown',
            keycode: event.keycode,
            key: UiohookKey[event.keycode] || `Unknown(${event.keycode})`,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey
        });

        // Exit on Escape key
        if (event.keycode === UiohookKey.Escape) {
            stopTracking();
        }
    });

    console.log('Started tracking global input events');
    if (mainWindow) {
        mainWindow.webContents.send('tracking-status', { isTracking: true });
    }
}

function stopTracking() {
    if (!isTracking) return;
    isTracking = false;

    // Clear the screenshot interval
    if (trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }

    uIOhook.removeAllListeners();
    console.log('Stopped tracking global input events');
    if (mainWindow) {
        mainWindow.webContents.send('tracking-status', { isTracking: false });
    }

}
// Add this after the existing code, before app.whenReady()
async function saveActHoursLocally(projectID, taskID, data) {
    try {
        // Create the folder path: public/screenshots/project_{projectID}/task_{taskID}/
        const screenshotsDir = path.join(
            'public',
            'screenshots',
            `project_${projectID}`,
            `task_${taskID}`
        );

        try {
            // Ensure the directory exists
            await fs.ensureDir(screenshotsDir);

            // Prepare the file path with timestamp
            const timestamp = new Date().getTime();
            const filePath = path.join(screenshotsDir, `taskData_${taskID}.json`);

            // Prepare data to save
            const dataToSave = {
                ...data,
                taskID,
                projectID,
                lastUpdated: new Date().toISOString(),
                actHours: data.actHours,
                isExceeded: data.isExceeded,
            };

            // Save to file
            await fs.writeJson(filePath, dataToSave, { spaces: 2 });
            console.log(`ActHours data saved locally at: ${filePath}`);
            return true;
        } catch (dirError) {
            console.error('Error creating directory or saving file:', dirError);
            return false;
        }
    } catch (error) {
        console.error('Error in saveActHoursLocally:', error);
        return false;
    }
}

async function loadActHoursLocally() {
    try {
        const screenshotsDir = path.join('public', 'screenshots');

        // Check if directory exists
        const dirExists = await fs.pathExists(screenshotsDir);
        if (!dirExists) {
            console.log('Screenshots directory does not exist, returning empty data');
            return {};
        }

        const result = {};
        const projectDirs = await fs.readdir(screenshotsDir);

        for (const projectDir of projectDirs) {
            if (!projectDir.startsWith('project_')) continue;

            const taskDirs = await fs.readdir(path.join(screenshotsDir, projectDir));

            for (const taskDir of taskDirs) {
                if (!taskDir.startsWith('task_')) continue;

                const taskPath = path.join(screenshotsDir, projectDir, taskDir);
                const files = (await fs.readdir(taskPath)).filter(f => f.startsWith('acthours_') && f.endsWith('.json'));

                // Get the most recent file
                if (files.length > 0) {
                    const latestFile = files.sort().pop();
                    try {
                        const fileData = await fs.readJson(path.join(taskPath, latestFile));
                        const taskId = fileData.taskID;
                        if (taskId) {
                            result[taskId] = {
                                actHours: fileData.actHours,
                                isExceeded: fileData.isExceeded
                            };
                        }
                    } catch (err) {
                        console.error(`Error reading file ${latestFile}:`, err);
                    }
                }
            }
        }

        return result;
    } catch (error) {
        console.error('Error loading actHours data:', error);
        return {};
    }
}
// Initialize iohook
const iohook = uIOhook;

// Start the app
if (app) {
    app.whenReady().then(() => {
        // Register IPC handlers
        ipcMain.handle('start-tracking', async () => {
            startTracking();
            return { success: true, isTracking };
        });

        ipcMain.handle('stop-tracking', async () => {
            stopTracking();
            return { success: true, isTracking };
        });
        ipcMain.on('tracking-status', (event, data) => {
            mainWindow.webContents.send('tracking-status', data);
        });

        ipcMain.on('tracking-error', (event, error) => {
            mainWindow.webContents.send('tracking-error', error);
        });
        // Add this with your other IPC handlers in main.js
        ipcMain.handle('get-tracking-status', async () => {
            return { isTracking };
        });
        ipcMain.handle('set-tracking-context', (event, context) => {
            currentProjectID = context.projectID;
            currentUserID = context.userID;
            currentProjectName = context.projectname;
            currentTaskName = context.taskname;
            // Priority order: subactionItemID > actionItemID > subtaskID > taskID
            if (context.subactionItemID) {
                currentTaskID = context.subactionItemID;
                currentTaskName = context.subactionname;
                console.log('Tracking subaction item with ID:', currentTaskID);
            } else if (context.actionItemID) {
                currentTaskID = context.actionItemID;
                currentTaskName = context.actionname;
                console.log('Tracking action item with ID:', currentTaskID);
            } else if (context.subtaskID) {
                currentTaskID = context.subtaskID;
                currentTaskName = context.subtaskname;
                console.log('Tracking subtask with ID:', currentTaskID);
            } else {
                currentTaskID = context.taskID;
                currentTaskName = context.taskname;
                console.log('Tracking task with ID:', currentTaskID);
            }

            return { success: true };
        });
        ipcMain.handle('take-screenshot', async (_, mouse, keyboard) => {
            try {
                return await takeScreenshot(mouse, keyboard);
            } catch (error) {
                console.error('Screenshot IPC failed:', error);
                mainWindow.webContents.send('tracking-error', {
                    type: 'api-failure',
                    message: error.message
                });
                return { success: false };
            }
        });
        ipcMain.handle('save-act-hours', async (event, { taskId, projectId, actHours, isExceeded }) => {
            try {
                // First try to save to the server
                const response = await fetch(`https://vw.aisrv.in/node_backend/postProjectV1`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskID: taskId,
                        projectID: projectId,
                        actHours,
                        isExceeded
                    })
                });

                if (response.ok) {
                    // If server save is successful, save locally with isSynced=true
                    await saveActHoursLocally(projectId, taskId, {
                        actHours,
                        isExceeded,
                        isSynced: true,
                        lastServerSync: new Date().toISOString()
                    });
                    return { success: true, isLocal: false };
                }

                throw new Error('Failed to save to server');
            } catch (error) {
                console.log('Server save failed, saving locally only');
                // If server save fails, save locally only
                const success = await saveActHoursLocally(projectId, taskId, {
                    actHours,
                    isExceeded
                });
                return { success, isLocal: true };
            }
        });

        ipcMain.handle('load-act-hours', async () => {
            return await loadActHoursLocally();
        });
        function createWindow() {
            mainWindow = new BrowserWindow({
                width: 600,
                height: 900,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: path.join(__dirname, 'preload.js')
                },

            });

            // Load the app
            const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, 'build/index.html')}`;
            mainWindow.loadURL(startUrl);

            // Open the DevTools in development
            if (process.env.NODE_ENV === 'development') {
                mainWindow.webContents.openDevTools();
            }
        }

        createWindow();
        initScreenshotWatcher();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            stopTracking();
            app.quit();
        }
    });

    // Clean up on app quit
    app.on('will-quit', () => {
        stopTracking();
        uIOhook.stop();
    });
}  