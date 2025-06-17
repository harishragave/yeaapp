const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const { uIOhook, UiohookKey } = require('uiohook-napi');
const { desktopCapturer, screen } = electron;
const path = require('path');
const fs = require('fs-extra');

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

// Set screenshot interval to 5 minutes (300,000 ms)
const SCREENSHOT_INTERVAL = 5 * 60 * 1000;
let currentProjectID = null;
let currentUserID = null;
let currentTaskID = null;
let currentProjectName = null;
let currentTaskName = null;
// Remove the original saveToWorkdiary function and replace with:
async function saveToWorkdiary(data) {
    try {
        console.log('Saving to workdiary, thumbnailURL exists:', !!data.thumbnailURL);
        console.log('Data being sent to server:', {
            ...data,
            imageURL: data.imageURL ? '[IMAGE_DATA]' : 'MISSING',
            thumbnailURL: data.thumbnailURL ? '[THUMBNAIL_DATA]' : 'MISSING',
            keyboardJSON: data.keyboardJSON,
            mouseJSON: data.mouseJSON
        });

        const response = await fetch('https://vw.aisrv.in/node_backend/postProjectV1', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                projectID: data.projectID,
                projectName: data.projectName,
                taskName: data.taskName,
                userID: data.userID,
                taskID: data.taskID,
                screenshotTimeStamp: data.screenshotTimeStamp.toISOString(),
                calcTimeStamp: data.calcTimeStamp.toISOString(),
                keyboardJSON: JSON.parse(data.keyboardJSON),
                mouseJSON: JSON.parse(data.mouseJSON),
                imageURL: data.imageURL,
                thumbnailURL: data.thumbnailURL,
                activeFlag: 1,
                deletedFlag: 0
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

function getHourlyFolderName() {
    const now = new Date();
    const hour = now.getHours();
    // Format as "10-11" for 10:00-10:59
    return `${String(hour).padStart(2, '0')}-${String(hour + 1).padStart(2, '0')}`;
}

async function saveScreenshotLocally(data) {
    try {
        const now = new Date();
        const hourFolder = getHourlyFolderName();
        
        const screenshotsDir = path.join(
            'public',
            'screenshots',
            `project_${data.projectID}`,
            `task_${data.taskID}`,
            now.toISOString().split('T')[0], // YYYY-MM-DD
            hourFolder
        );

        await fs.ensureDir(screenshotsDir);
        const timestamp = now.getTime();
        const filePath = path.join(screenshotsDir, `screenshot_${timestamp}.json`);

        // Create a clean copy of the data without the unwanted fields
        const { savedLocally, lastUpdated, ...cleanData } = data;
        
        // Ensure keyboardJSON and mouseJSON are proper objects if they exist
        if (cleanData.keyboardJSON && typeof cleanData.keyboardJSON === 'string') {
            try {
                cleanData.keyboardJSON = JSON.parse(cleanData.keyboardJSON);
            } catch (e) {
                console.error('Error parsing keyboardJSON:', e);
            }
        }
        
        if (cleanData.mouseJSON && typeof cleanData.mouseJSON === 'string') {
            try {
                cleanData.mouseJSON = JSON.parse(cleanData.mouseJSON);
            } catch (e) {
                console.error('Error parsing mouseJSON:', e);
            }
        }

        // Add timestamps
        const dataToSave = {
            ...cleanData,
            screenshotTimeStamp: cleanData.screenshotTimeStamp?.toISOString?.() || new Date().toISOString(),
            calcTimeStamp: cleanData.calcTimeStamp?.toISOString?.() || new Date().toISOString()
        };

        await fs.writeJson(filePath, dataToSave, { spaces: 2 });
        console.log(`Screenshot saved locally at: ${filePath}`);
        return { 
            success: true, 
            savedLocally: true,
            filePath: filePath
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

        const fullSizeBase64 = sources[0].thumbnail.resize({
            width: 1200,
            height: 800,
            quality: 'good'
        }).toJPEG(60).toString('base64');

        const thumbnailBase64 = sources[0].thumbnail.resize({
            width: 300,
            height: 200,
            quality: 'good'
        }).toJPEG(60).toString('base64');

        const workdiaryData = {
            projectID: currentProjectID,
            userID: currentUserID,
            taskID: currentTaskID,
            screenshotTimeStamp: new Date(),
            calcTimeStamp: new Date(),
            keyboardJSON: JSON.stringify({ count: keyboardPressCount }),
            mouseJSON: JSON.stringify({ count: mouseClickCount }),
            imageURL: fullSizeBase64,
            thumbnailURL: thumbnailBase64,
            activeFlag: 1,
            deletedFlag: 0,
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

    // Start listening to all events
    uIOhook.start();

    // Set up interval for screenshots (every 5 minutes) - ONLY when tracking starts
    trackingInterval = setInterval(() => {
        // Only take screenshot if we have activity counts
        if (typeof mouseClickCount !== 'undefined' && typeof keyboardPressCount !== 'undefined') {
            takeScreenshot(mouseClickCount, keyboardPressCount);
        }
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
        // Set up will-quit handler
        app.on('will-quit', () => {
            stopTracking();
            uIOhook.stop();
            uIOhook.unregisterAllShortcuts();
        });

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
        uIOhook.unload();
        uIOhook.stop();
    });
}  